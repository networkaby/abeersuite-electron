// Gift-card helpers. Issuance GL (Dr Cash / Cr Liability) lives in the issue
// route (it needs a JE reference series); these are the tx-aware balance moves
// shared by the POS sale (redeem) and return (refund) routes.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { moneyNumber, round2 } from "@/shared/lib/format/moneyInr";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface GiftCardLite {
    id: number;
    code: string;
    balance: number;
    status: string;
    enabled: boolean;
    expiresAt: Date | null;
}

/// Find a redeemable gift card by code: ACTIVE, enabled, not expired, positive
/// balance. `enabled` is surfaced so callers can reject a manually-disabled card.
export async function lookupActiveGiftCard(tx: Tx, code: string, now: Date): Promise<GiftCardLite | null> {
    const gc = await tx.giftCard.findFirst({ where: { code: { equals: code.trim(), mode: "insensitive" } } });
    if (!gc) return null;
    const lite: GiftCardLite = { id: gc.id, code: gc.code, balance: moneyNumber(gc.balance), status: gc.status, enabled: gc.enabled, expiresAt: gc.expiresAt };
    if (gc.status !== "ACTIVE") return lite;            // surfaced to the caller with status
    if (gc.expiresAt && gc.expiresAt < now) return { ...lite, status: "EXPIRED" };
    return lite;
}

/**
 * The card's balance moved between the cashier's lookup and the draw: a double
 * submit, a second till, or a balance that has gone negative after two tills spent
 * the same card while apart. The sale must not go through on the stale figure.
 */
export class GiftCardBalanceChangedError extends Error {
    readonly code = "GIFT_CARD_BALANCE_CHANGED";
    constructor(message = "Gift card balance changed — look the card up again.") {
        super(message);
        this.name = "GiftCardBalanceChangedError";
    }
}

/// Draw down a gift card inside the sale tx (validated by the caller).
///
/// Conditional on the balance still covering the amount, in ONE statement, so two
/// draws on the same till cannot both succeed against one lookup. A card whose
/// balance is already below zero — two tills drew it while apart, and the rebuild
/// summed both — is refused outright.
export async function redeemGiftCard(
    tx: Tx, args: { giftCardId: number; amount: number; universalVoucherId: number; createdById: number },
): Promise<number> {
    const drawn = await tx.giftCard.updateMany({
        where: { id: args.giftCardId, status: "ACTIVE", balance: { gte: args.amount } },
        data: { balance: { decrement: args.amount } },
    });
    if (drawn.count === 0) throw new GiftCardBalanceChangedError();

    const gc = await tx.giftCard.findUniqueOrThrow({ where: { id: args.giftCardId }, select: { balance: true } });
    const newBal = round2(moneyNumber(gc.balance));
    if (newBal <= 0.005) {
        await tx.giftCard.update({ where: { id: args.giftCardId }, data: { status: "REDEEMED" } });
    }
    await tx.giftCardTxn.create({
        data: { giftCardId: args.giftCardId, type: "REDEEM", amount: -args.amount, universalVoucherId: args.universalVoucherId, balanceAfter: newBal, createdById: args.createdById },
    });
    return newBal;
}

/**
 * Rebuild `GiftCard.balance` from the signed `GiftCardTxn` ledger, and keep the one
 * status that follows the balance (ACTIVE ⇄ REDEEMED) in step.
 *
 * `balance` is a running total, and running totals never travel between a counter
 * and Supabase (see `cacheColumns` in gen-sync-registry.ts): each side sums its own
 * ledger after txn rows land. A DRAFT card has no txn yet — its balance is the value
 * typed on the card — so cards with no ledger rows are left alone.
 *
 * DRAFT, EXPIRED and VOID are the office's decisions and are not touched here.
 */
export async function recomputeGiftCardBalances(tx: Tx, giftCardIds: number[]): Promise<void> {
    const ids = [...new Set(giftCardIds)];
    if (ids.length === 0) return;

    const [sums, cards] = await Promise.all([
        tx.giftCardTxn.groupBy({ by: ["giftCardId"], where: { giftCardId: { in: ids } }, _sum: { amount: true } }),
        tx.giftCard.findMany({ where: { id: { in: ids } }, select: { id: true, balance: true, status: true } }),
    ]);
    const ledger = new Map(sums.map((r) => [r.giftCardId, round2(moneyNumber(r._sum.amount ?? 0))]));

    for (const card of cards) {
        const truth = ledger.get(card.id);
        if (truth === undefined) continue; // no ledger yet: a DRAFT card, leave it
        const status = card.status === "ACTIVE" && truth <= 0.005 ? "REDEEMED"
            : card.status === "REDEEMED" && truth > 0.005 ? "ACTIVE"
            : card.status;
        if (round2(moneyNumber(card.balance)) === truth && status === card.status) continue;
        await tx.giftCard.update({ where: { id: card.id }, data: { balance: truth, status } });
    }
}

/**
 * How much of a sale's gift-card draw can still be put back on the card.
 *
 *   refundable = Σ|REDEEM on the sale| − Σ REFUND already made against that sale
 *
 * A refund is recorded against the spine of whatever caused it — the sale's own
 * spine when the sale was cancelled, the credit note's spine when goods came back
 * — so "already refunded" has to look at the sale AND every SALE_RETURN hanging
 * off it. This is the definition; the return-search endpoint computes the same
 * thing in batch for its list.
 *
 * Returns null when the sale drew no card, or when nothing is left to give back.
 */
export async function giftCardRefundableForSale(
    tx: Tx, args: { saleSpineId: number; saleDetailId: number },
): Promise<{ giftCardId: number; code: string; drawn: number; refunded: number; refundable: number } | null> {
    const draws = await tx.giftCardTxn.findMany({
        where:  { universalVoucherId: args.saleSpineId, type: "REDEEM" },
        select: { giftCardId: true, amount: true, giftCard: { select: { code: true } } },
    });
    if (draws.length === 0) return null;

    // POS draws at most one card per sale; if that ever changes, the first is the
    // one we can reason about, so refuse rather than guess.
    if (draws.length > 1) return null;
    const draw = draws[0];
    const drawn = round2(Math.abs(moneyNumber(draw.amount)));

    const returns = await tx.voucherDetail.findMany({
        where:  { refVoucherId: args.saleDetailId, universalVoucher: { type: "SALE_RETURN" } },
        select: { universalVoucherId: true },
    });
    const spineIds = [args.saleSpineId, ...returns.map((r) => r.universalVoucherId).filter((x): x is number => x != null)];

    const refunds = await tx.giftCardTxn.aggregate({
        where:  { universalVoucherId: { in: spineIds }, type: "REFUND", giftCardId: draw.giftCardId },
        _sum:   { amount: true },
    });
    const refunded = round2(moneyNumber(refunds._sum.amount ?? 0));
    const refundable = round2(drawn - refunded);
    if (refundable <= 0.005) return null;

    return { giftCardId: draw.giftCardId, code: draw.giftCard.code, drawn, refunded, refundable };
}

/// Restore balance on a return or a cancel (amount computed by the caller).
///
/// The database does the addition, in one statement, exactly as `redeemGiftCard`
/// lets it do the subtraction — so two refunds of the same card queue up and both
/// are counted. Reading the balance, adding, then writing it back lost one of the
/// two whenever they overlapped: the `GiftCardTxn` rows were both written, so the
/// history said one thing and the card said another, and nothing put it right
/// (`recomputeGiftCardBalances` runs only on the sync path, so an office-only
/// database never re-sums it).
export async function refundGiftCard(
    tx: Tx, args: { giftCardId: number; amount: number; universalVoucherId: number; createdById: number },
): Promise<number> {
    const gc = await tx.giftCard.update({
        where:  { id: args.giftCardId },
        data:   { balance: { increment: args.amount } },
        select: { balance: true, status: true },
    });
    const newBal = round2(moneyNumber(gc.balance));

    // A card the sale emptied went REDEEMED; money back on it makes it spendable
    // again. DRAFT / EXPIRED / VOID are the office's decisions and stay put.
    if (gc.status === "REDEEMED" && newBal > 0.005) {
        await tx.giftCard.update({ where: { id: args.giftCardId }, data: { status: "ACTIVE" } });
    }
    await tx.giftCardTxn.create({
        data: { giftCardId: args.giftCardId, type: "REFUND", amount: args.amount, universalVoucherId: args.universalVoucherId, balanceAfter: newBal, createdById: args.createdById },
    });
    return newBal;
}
