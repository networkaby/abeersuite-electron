// SERVER-ONLY. Books an online gateway collection into the GL: one RECEIPT
// voucher — Dr the gateway's settlement ledger · Cr the order's customer account —
// posted the moment the gateway confirms payment, so bank/receivables never drift
// from reality. The receipt stands as a customer ADVANCE (no allocation yet); the
// order's Sale invoice allocates against it when raised.
//
// Fired from markOrderPaid (all gateway success paths). Best-effort by contract:
// the caller try/catches — a bookkeeping failure must never fail the payment.
// Idempotent via the caller (markOrderPaid posts only on the PENDING→PAID flip)
// plus the receiptVoucherId stamp on the order's JSON.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { settlementAccountIdOf } from "@/modules/pos/lib/paymentGateways";
import { postReceiptVoucher } from "@/modules/accountancy/lib/postReceiptVoucher";
import { businessToday } from "@/shared/lib/format/formatDate";
import { findUserIdsHoldingRoles } from "@/shared/lib/auth/roleHolders";

/** Seeded HQ branch — the online channel runs under HQ (see bootstrap §1). */
const HQ_BRANCH_ID = "BR-HQ";

/**
 * The user auto-posted documents are attributed to: the senior-most admin (R1).
 *
 * Holders come from `findUserIdsHoldingRoles`, which counts **Position
 * appointments** as well as the legacy `User.role` override. Matching on
 * `User.role` alone — which this did until 2026-09-04 — found nobody on a
 * normally-seeded org (an appointed admin has `role = null`) and dropped
 * straight into the any-user fallback below, stamping the RECEIPT's
 * `createdById` with whoever happened to be added to the system first. Same
 * root cause as the `createSystemInboxNotifications` fix.
 */
async function resolveSystemActorId(): Promise<number | null> {
    const admins = await findUserIdsHoldingRoles(["R1"]);
    if (admins.length > 0) return Math.min(...admins);

    // Genuine last resort — an org with no R1 holder at all. Loud, because every
    // receipt booked from here then carries a creator name that is a guess.
    const any = await prisma.user.findFirst({ orderBy: { id: "asc" }, select: { id: true } });
    if (any) console.error(`[onlineReceipt] no R1 holder — attributing receipts to user ${any.id}`);
    return any?.id ?? null;
}

export type OnlineReceiptResult = { voucherId: number; voucherRef: string };

/**
 * Post the advance RECEIPT for a just-paid online order. Returns the voucher, or
 * null when a precondition is missing (no ledger / no customer account / already
 * receipted) — logged, never thrown, so the payment flow is untouchable.
 */
export async function postOnlineOrderReceipt(opts: {
    ticketId: number;
    provider: string;
    paymentRef: string;
}): Promise<OnlineReceiptResult | null> {
    const { ticketId, provider, paymentRef } = opts;

    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
            accountId: true,
            order: { select: { totalPaise: true, shippingChargePaise: true, shippingAddress: true } },
        },
    });
    if (!ticket?.order) {
        console.error(`[onlineReceipt] order ${ticketId} not found — receipt skipped`);
        return null;
    }
    const addr = (ticket.order.shippingAddress ?? {}) as Record<string, unknown>;
    if (addr.receiptVoucherId) return null; // already receipted (defensive re-entry)

    if (!ticket.accountId) {
        console.error(`[onlineReceipt] order ${ticketId} has no customer account — receipt skipped`);
        return null;
    }

    const gateway = await prisma.paymentGateway.findFirst({
        where: { provider },
        select: { displayName: true, configJson: true },
    });
    const settlementAccountId = settlementAccountIdOf(gateway?.configJson);
    if (!settlementAccountId) {
        // Shouldn't happen — a gateway without a ledger isn't offered at checkout.
        console.error(`[onlineReceipt] ${provider} has no settlement ledger — receipt skipped`);
        return null;
    }

    const actorId = await resolveSystemActorId();
    if (!actorId) {
        console.error(`[onlineReceipt] no user to attribute the receipt to — skipped`);
        return null;
    }

    // Online channel books under HQ (fall back to the first branch if renamed).
    const branch =
        (await prisma.branch.findUnique({ where: { id: HQ_BRANCH_ID }, select: { id: true } })) ??
        (await prisma.branch.findFirst({ orderBy: { id: "asc" }, select: { id: true } }));

    const grandPaise = (ticket.order.totalPaise ?? 0) + (ticket.order.shippingChargePaise ?? 0);
    const amountRupees = Math.round(grandPaise) / 100;
    const label = gateway?.displayName ?? provider;

    const result = await prisma.$transaction(async (tx) => {
        const receipt = await postReceiptVoucher(tx, {
            customerAccountId: ticket.accountId!,
            tenders: [
                {
                    accountId: settlementAccountId,
                    amount: amountRupees,
                    description: `${label} ref ${paymentRef}`,
                },
            ],
            date: businessToday(),
            userId: actorId,
            narration: `Online payment via ${label} for Order #${ticketId} — auto-posted`,
            branchId: branch?.id,
            // No allocation — stands as a customer advance until the order's Sale
            // invoice is raised and allocates against it.
        });
        // Stamp the receipt on the order so the invoice step can allocate it and a
        // re-entry never double-posts.
        await tx.ticketOrder.update({
            where: { ticketId },
            data: {
                shippingAddress: {
                    ...addr,
                    receiptVoucherId: receipt.voucherId,
                    receiptVoucherRef: receipt.voucherRef,
                },
            },
        });
        return receipt;
    });

    return { voucherId: result.voucherId, voucherRef: result.voucherRef };
}
