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
 * Resolve the advance collected against an inv order — the sum of its POS advance
 * receipts (linked by the note "Advance against <ref>") plus one source voucher id
 * for the GL pay-back step. Returns 0 when nothing was collected. (Shop advances are
 * a follow-up; only counter/office orders carry POS advance receipts today.)
 */
async function resolveAdvance(ref: OrderRef): Promise<{ amountPaise: number; sourceVoucherId: number | null }> {
    if (ref.source !== "inv") return { amountPaise: 0, sourceVoucherId: null };
    const order = await prisma.invVoucher.findUnique({ where: { id: ref.id }, select: { reference: true } });
    if (!order) return { amountPaise: 0, sourceVoucherId: null };
    const receipts = await prisma.posReceipt.findMany({
        where: { note: { contains: `Advance against ${order.reference}` } },
        select: { amountPaise: true, voucherId: true },
    });
    const amountPaise = receipts.reduce((s, r) => s + Number(r.amountPaise), 0);
    const sourceVoucherId = receipts.find((r) => r.voucherId != null)?.voucherId ?? null;
    return { amountPaise, sourceVoucherId };
}

/**
 * Spawn a Refund for a rejected/cancelled order that collected an advance.
 * Idempotent (one refund per order); a no-op when there's no advance to refund.
 * GL-silent — the actual pay-back (a Payment voucher reversing the advance Receipt)
 * is posted when staff mark the refund Refunded (TODO(refund-apply)).
 */
export async function spawnRefund(ref: OrderRef): Promise<void> {
    const existing = await prisma.refund.findFirst({
        where: { orderSource: ref.source, orderId: ref.id },
        select: { id: true },
    });
    if (existing) return;
    const { amountPaise, sourceVoucherId } = await resolveAdvance(ref);
    if (amountPaise <= 0) return; // nothing was collected → nothing to refund
    const pipeline = await getRefundPipeline();
    const entry = pipeline?.statuses.find((s) => s.isEntryPoint) ?? pipeline?.statuses[0];
    if (!pipeline || !entry) return;
    await prisma.refund.create({
        data: {
            orderSource: ref.source,
            orderId: ref.id,
            pipelineId: pipeline.id,
            statusId: entry.id,
            amountPaise,
            sourceVoucherId,
            reason: "Order rejected / cancelled",
        },
    });
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
    const refund = await prisma.refund.findUnique({
        where: { id: refundId },
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
        const v = await prisma.invVoucher.findUnique({ where: { id: refund.orderId }, select: { reference: true } });
        orderRef = v?.reference ?? null;
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
    await prisma.refund.update({ where: { id: refundId }, data: { payoutVoucherId } });
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
