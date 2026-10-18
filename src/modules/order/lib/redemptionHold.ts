import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { OrderRef } from "./orderAdapter";

// O2C redemption holds (Phase 2b). Sibling of reservation.ts, but for *reward value*
// rather than stock: a loyalty / coupon / gift-card redemption applied to an ORDER is
// HELD (recorded, not yet burned) so it can't be double-spent before the order is
// invoiced. At Fulfil the hold is EXECUTED (the Sale burns the reward for real); on
// Cancel/Return it's RELEASED. GL-silent — like reservations this only tracks intent;
// the ledger/wallet effect lives on the Sale at Fulfil, never here.
//
// Where each step happens (counter POS_ORDER, ref { source: "inv", id: voucherDetail.id }):
//   • hold    — /api/pos/order, when the order is created with `redemptions`.
//   • execute — /api/pos/sale converting the order (sourceVoucherId). The sale burns the
//     rewards through its own normal POS path (loyalty / coupon / gift card + their GL
//     legs); `executeRedemptions` flips the holds inside that same transaction.
//   • release — cancelling the order (voucher cancel, or a CANCELLED / RETURNED stage).
//   • re-hold — cancelling the converted sale gives the rewards back, so the holds
//     return to HELD and the reopened order can be converted again.
//   • cap     — editing the order shrinks the holds to fit the new total.
// Online shop orders do NOT use holds — checkout freezes the reward on the order itself.

export type RewardType = "LOYALTY" | "COUPON" | "GIFT_CARD";

export interface RedemptionIntent {
    rewardType: RewardType;
    rewardRef?: string | null;   // coupon / gift-card code
    rewardId?: number | null;    // Coupon.id / GiftCard.id (null for loyalty wallet)
    accountId?: number | null;   // customer ledger account
    points?: number | null;      // loyalty points (null for coupon / gift-card)
    amount: number;              // rupee value held
    meta?: unknown;              // reward-specific plan (e.g. loyalty FIFO lot consumption)
}

export interface HeldRedemption extends Omit<RedemptionIntent, "meta"> {
    id: number;
    status: "HELD" | "EXECUTED" | "RELEASED";
    meta: Prisma.JsonValue;
}

/** Record reward holds for an order (idempotent — no-op if holds already exist). */
export async function holdRedemptions(ref: OrderRef, intents: RedemptionIntent[]): Promise<void> {
    const valid = intents.filter((i) => i && i.amount > 0);
    if (valid.length === 0) return;
    await prisma.$transaction(async (tx) => {
        const already = await tx.redemptionHold.count({
            where: { orderSource: ref.source, orderId: ref.id, status: "HELD" },
        });
        if (already > 0) return; // idempotent
        for (const i of valid) {
            await tx.redemptionHold.create({
                data: {
                    orderSource: ref.source,
                    orderId: ref.id,
                    rewardType: i.rewardType,
                    rewardRef: i.rewardRef ?? null,
                    rewardId: i.rewardId ?? null,
                    accountId: i.accountId ?? null,
                    points: i.points ?? null,
                    amount: i.amount,
                    meta: i.meta === undefined ? undefined : (i.meta as Prisma.InputJsonValue),
                    status: "HELD",
                },
            });
        }
    }, { timeout: 30_000, maxWait: 10_000 });
}

/** Thrown when an order's holds changed under the sale (another till executed or
 *  released them first). The sale rolls back; the route answers 409. */
export class RedemptionHoldChangedError extends Error {}

/** An order's HELD redemptions, for the converting sale to check against before it posts. */
export async function findHeldRedemptions(ref: OrderRef, db: Prisma.TransactionClient = prisma): Promise<HeldRedemption[]> {
    const held = await db.redemptionHold.findMany({
        where: { orderSource: ref.source, orderId: ref.id, status: "HELD" },
        orderBy: { id: "asc" },
    });
    return held.map((h) => ({
        id: h.id,
        rewardType: h.rewardType as RewardType,
        rewardRef: h.rewardRef,
        rewardId: h.rewardId,
        accountId: h.accountId,
        points: h.points,
        amount: Number(h.amount),
        meta: h.meta,
        status: "HELD" as const,
    }));
}

/**
 * Mark the holds the sale has just burned EXECUTED, inside the sale's own transaction.
 * The sale itself burns the rewards (its normal loyalty / coupon / gift-card path), so
 * this only closes the holds. Flips exactly the ids the sale checked; if any is no
 * longer HELD, another till got there first — throws so the whole sale rolls back and
 * the reward is never burned twice.
 */
export async function executeRedemptions(holdIds: number[], tx: Prisma.TransactionClient): Promise<void> {
    if (holdIds.length === 0) return;
    const flipped = await tx.redemptionHold.updateMany({
        where: { id: { in: holdIds }, status: "HELD" },
        data: { status: "EXECUTED" },
    });
    if (flipped.count !== holdIds.length) {
        throw new RedemptionHoldChangedError("This order's rewards were already used or released on another screen. Reload the order and try again.");
    }
}

/** Release any held redemptions for an order (cancel / return). Nothing was burned,
 *  so there's no ledger/wallet effect to undo — just flip the status. */
export async function releaseRedemptions(ref: OrderRef, db: Prisma.TransactionClient = prisma): Promise<void> {
    await db.redemptionHold.updateMany({
        where: { orderSource: ref.source, orderId: ref.id, status: "HELD" },
        data: { status: "RELEASED" },
    });
}

/** The sale that converted this order was cancelled — its cancel already gave the
 *  rewards back, so the holds go back to HELD for the next conversion. */
export async function reholdRedemptions(ref: OrderRef, db: Prisma.TransactionClient): Promise<void> {
    await db.redemptionHold.updateMany({
        where: { orderSource: ref.source, orderId: ref.id, status: "EXECUTED" },
        data: { status: "HELD" },
    });
}

// Coupon value goes first, then points, then the gift card — the card is a payment,
// so it is what shrinks when the bill does.
const CAP_ORDER: Record<RewardType, number> = { COUPON: 0, LOYALTY: 1, GIFT_CARD: 2 };

/**
 * The order was edited — shrink its holds so together they never exceed the new total.
 * A hold cut to ₹0 is released; loyalty points shrink in the same ratio (rounded down,
 * so the ₹ value never grows).
 */
export async function capRedemptionsToTotal(ref: OrderRef, total: number, db: Prisma.TransactionClient): Promise<void> {
    const held = (await findHeldRedemptions(ref, db)).sort((a, b) => CAP_ORDER[a.rewardType] - CAP_ORDER[b.rewardType] || a.id - b.id);
    let left = Math.max(0, total);
    for (const h of held) {
        const amount = Math.min(h.amount, left);
        left = Math.round((left - amount) * 100) / 100;
        if (amount >= h.amount) continue;
        if (amount <= 0.005) {
            await db.redemptionHold.update({ where: { id: h.id }, data: { status: "RELEASED" } });
            continue;
        }
        const points = h.points == null ? null : Math.floor((h.points * amount) / h.amount);
        if (points === 0) {
            await db.redemptionHold.update({ where: { id: h.id }, data: { status: "RELEASED" } });
            continue;
        }
        await db.redemptionHold.update({ where: { id: h.id }, data: { amount, points } });
    }
}
