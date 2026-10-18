import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { OrderRef } from "@/modules/order/lib/orderAdapter";

// O2C Refund sub-pipeline (P9). A Refund is spawned when an order that collected an
// advance is Rejected/Cancelled, and tracks the pay-back independently (Requested →
// Approved → Refunded / Rejected). Sibling of the Delivery sub-pipeline (P8).
export const REFUND_PIPELINE_NAME = "refund" as const;

// Seeded P9 refund stage ids (bootstrap-seed.ts). REFUNDED is the pay-out trigger.
export const REFUND_STAGE = {
    REQUESTED: "S57",
    APPROVED: "S58",
    REFUNDED: "S59",
    REJECTED: "S60",
} as const;

export async function getRefundPipeline() {
    return prisma.pipeline.findUnique({
        where: { name: REFUND_PIPELINE_NAME },
        include: { statuses: { orderBy: { order: "asc" } } },
    });
}

/**
 * Resolve the advance collected against an inv order — the sum of its advance
 * receipts plus one source voucher id for the GL pay-back step. Returns 0 when
 * nothing was collected. (Shop advances are a follow-up; only counter/office
 * orders carry advance receipts today.)
 *
 * Found through the receipt's ADVANCE_FOR VoucherLink, which points at the
 * order's spine. Until 2026-09-13 this matched the text "Advance against <ref>"
 * in the old pos_receipts table — so it missed the advance whenever the order's
 * reference changed, and counted a deleted receipt as money still collected.
 */
async function resolveAdvance(ref: OrderRef): Promise<{ amountPaise: number; sourceVoucherId: number | null }> {
    if (ref.source !== "inv") return { amountPaise: 0, sourceVoucherId: null };
    const order = await prisma.voucherDetail.findUnique({ where: { id: ref.id }, select: { universalVoucherId: true } });   // 5D-6
    if (order?.universalVoucherId == null) return { amountPaise: 0, sourceVoucherId: null };
    const receipts = await prisma.universalVoucher.findMany({
        where: {
            type:      "RECEIPT",
            status:    "POSTED",
            links:     { some: { kind: "ADVANCE_FOR", targetId: String(order.universalVoucherId) } },
        },
        select: { id: true, lines: { select: { type: true, amount: true } } },
    });
    const amountPaise = receipts.reduce(
        (s, r) => s + Math.round(r.lines.filter((l) => l.type === "DEBIT").reduce((t, l) => t + Number(l.amount), 0) * 100),
        0,
    );
    return { amountPaise, sourceVoucherId: receipts[0]?.id ?? null };
}

/**
 * Spawn a Refund for a rejected/cancelled order that collected an advance.
 * Idempotent (one refund per order); a no-op when there's no advance to refund.
 * GL-silent — the actual pay-back (a Payment voucher reversing the advance Receipt)
 * is posted when staff mark the refund Refunded (api/refunds/[id]/status).
 */
export async function spawnRefund(ref: OrderRef): Promise<void> {
    // A refund is a Ticket (flavour "refund") + TicketRefund detail; the core Ticket
    // carries the pipeline stage, the detail the amount + polymorphic order ref.
    const existing = await prisma.ticket.findFirst({
        where: { refund: { orderSource: ref.source, orderId: ref.id } },
        select: { id: true },
    });
    if (existing) return;
    const { amountPaise, sourceVoucherId } = await resolveAdvance(ref);
    if (amountPaise <= 0) return; // nothing was collected → nothing to refund
    const pipeline = await getRefundPipeline();
    const entry = pipeline?.statuses.find((s) => s.isEntryPoint) ?? pipeline?.statuses[0];
    if (!pipeline || !entry) return;
    await prisma.ticket.create({
        data: {
            pipelineId: pipeline.id,
            status: entry.id,
            refund: {
                create: {
                    orderSource: ref.source,
                    orderId: ref.id,
                    amountPaise,
                    sourceVoucherId,
                    reason: "Order rejected / cancelled",
                },
            },
        },
    });
}

/**
 * Spawn a Refund (P9) for a SHOP order with an explicit amount — used by the
 * online return flow (RTO received back / customer return). The order's paid
 * money lives on its auto-posted advance RECEIPT; `sourceSpineId` is that
 * receipt's UniversalVoucher id, so the standard payout step (Dr customer /
 * Cr the receipt's DEBIT ledger — the gateway settlement ledger) pays the money
 * back the way it came. Idempotent — one refund per order.
 */
export async function spawnShopRefund(params: {
    orderId: number;
    amountPaise: number;
    sourceSpineId: number | null;
    reason: string;
}): Promise<{ refundTicketId: number; already: boolean } | null> {
    const existing = await prisma.ticket.findFirst({
        where: { refund: { orderSource: "shop", orderId: params.orderId } },
        select: { id: true },
    });
    if (existing) return { refundTicketId: existing.id, already: true };
    if (params.amountPaise <= 0) return null;
    const pipeline = await getRefundPipeline();
    const entry = pipeline?.statuses.find((s) => s.isEntryPoint) ?? pipeline?.statuses[0];
    if (!pipeline || !entry) return null;
    const t = await prisma.ticket.create({
        data: {
            pipelineId: pipeline.id,
            status: entry.id,
            refund: {
                create: {
                    orderSource: "shop",
                    orderId: params.orderId,
                    amountPaise: params.amountPaise,
                    sourceVoucherId: params.sourceSpineId,
                    reason: params.reason,
                },
            },
        },
        select: { id: true },
    });
    return { refundTicketId: t.id, already: false };
}

/**
 * Resolve everything needed to post a refund's GL pay-back: the customer ledger to
 * debit and the cash/bank ledger to credit are read back from the original advance
 * Receipt (its party account + its DEBIT line), so the money goes back the way it
 * came. Returns alreadyPaid=true if a payout was already posted (idempotency).
 */
export async function getRefundForPayout(refundId: number): Promise<{
    alreadyPaid: boolean;
    sourceVoucherId: number | null;
    amount: number;                    // rupees
    customerAccountId: number | null;
    cashBankAccountId: number | null;
    orderRef: string | null;
} | null> {
    const refund = await prisma.ticketRefund.findUnique({
        where: { ticketId: refundId },
        select: { payoutVoucherId: true, sourceVoucherId: true, amountPaise: true, orderSource: true, orderId: true },
    });
    if (!refund) return null;

    let customerAccountId: number | null = null;
    let cashBankAccountId: number | null = null;
    if (refund.sourceVoucherId) {
        // Phase 5 5E: sourceVoucherId points at the spine; lines are VoucherGlLine.
        const src = await prisma.universalVoucher.findUnique({
            where: { id: refund.sourceVoucherId },
            select: { partyAccountId: true, lines: { select: { accountId: true, type: true } } },
        });
        customerAccountId = src?.partyAccountId ?? null;
        // The advance Receipt debited cash/bank — refund pays back from the same ledger.
        cashBankAccountId = src?.lines.find((l) => l.type === "DEBIT")?.accountId ?? null;
    }

    let orderRef: string | null = null;
    if (refund.orderSource === "inv") {
        const v = await prisma.voucherDetail.findUnique({ where: { id: refund.orderId }, select: { universalVoucher: { select: { voucherNo: true } } } });   // 5D-6
        orderRef = v?.universalVoucher?.voucherNo ?? null;
    }

    return {
        alreadyPaid: refund.payoutVoucherId != null,
        sourceVoucherId: refund.sourceVoucherId,
        amount: refund.amountPaise / 100,
        customerAccountId,
        cashBankAccountId,
        orderRef,
    };
}

/** Link the posted Payment voucher onto the refund (idempotency + audit). */
export async function markRefundPaid(refundId: number, payoutVoucherId: number): Promise<void> {
    await prisma.ticketRefund.update({ where: { ticketId: refundId }, data: { payoutVoucherId } });
}

/** Validate that a statusId belongs to the refund pipeline. */
export async function assertRefundStatus(statusId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const st = await prisma.ticketStatus.findUnique({
        where: { id: statusId },
        select: { pipeline: { select: { name: true } } },
    });
    if (!st || st.pipeline?.name !== REFUND_PIPELINE_NAME) {
        return { ok: false, message: "Invalid status for the Refund pipeline" };
    }
    return { ok: true };
}
