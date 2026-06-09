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
// FOUNDATION NOTE (Phase 2b): the lifecycle below (hold → execute → release) is
// complete and the order backbone carries holds through it. The remaining slice is
// the *application* at execution — having the Fulfil Sale actually consume loyalty
// lots / record the coupon redemption / draw the gift card (+ the negative-charge GL
// legs) from the returned holds. Until that lands, do NOT ship the capture UI that
// produces holds, or a fulfilled order would show "redeemed" without burning the
// reward. See executeRedemptions' TODO.

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

/**
 * Mark an order's held redemptions EXECUTED and return them so the caller (the Fulfil
 * Sale) can burn each reward for real. Pass the Fulfil transaction client so the
 * status flip is atomic with the sale post.
 *
 * TODO(2b-apply): the caller does not yet apply the returned holds to the Sale
 * (consume loyalty lots via applyLoyaltyForSale / recordCouponRedemption /
 * redeemGiftCard + the negative-charge GL legs). Until that's implemented, holds are
 * only produced by an explicit API caller (no capture UI ships yet), so this stays a
 * no-op in practice.
 */
export async function executeRedemptions(ref: OrderRef, tx?: Prisma.TransactionClient): Promise<HeldRedemption[]> {
    const client = tx ?? prisma;
    const held = await client.redemptionHold.findMany({
        where: { orderSource: ref.source, orderId: ref.id, status: "HELD" },
    });
    if (held.length === 0) return [];
    await client.redemptionHold.updateMany({
        where: { orderSource: ref.source, orderId: ref.id, status: "HELD" },
        data: { status: "EXECUTED" },
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
        status: "EXECUTED" as const,
    }));
}

/** Release any held redemptions for an order (cancel / return). Nothing was burned,
 *  so there's no ledger/wallet effect to undo — just flip the status. */
export async function releaseRedemptions(ref: OrderRef): Promise<void> {
    await prisma.redemptionHold.updateMany({
        where: { orderSource: ref.source, orderId: ref.id, status: "HELD" },
        data: { status: "RELEASED" },
    });
}
