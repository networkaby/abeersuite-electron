// Pre-flight for un-cancel (restore): what will go SHORT if we take the rewards
// back?
//
// Cancelling a sale hands things back to the customer — money onto the gift card,
// the coupon's usage slot, redeemed loyalty points. Between the cancel and the
// restore any of those can have been spent on a later bill. Restoring takes them
// back regardless (the voucher's truth comes first), but the person doing it
// should see what will go short BEFORE it happens, not discover a negative card
// afterwards — so the route reports these and only proceeds once told to.
//
// Read-only. Anything reported here is a warning, never a hard stop.

import type { Prisma } from "@/generated/prisma/client";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { round2 } from "@/shared/lib/format/moneyInr";

export type RestoreConflict = {
    kind: "GIFT_CARD" | "COUPON" | "LOYALTY";
    /** Customer-readable name of the thing going short (card code, coupon name). */
    label: string;
    /** Plain sentence for the warning dialog. */
    message: string;
};

export async function findRestoreConflicts(
    tx: Prisma.TransactionClient,
    args: { universalVoucherId: number; partyAccountId: number | null },
): Promise<RestoreConflict[]> {
    const conflicts: RestoreConflict[] = [];
    const spineId = args.universalVoucherId;

    // ── Gift card: is the money the cancel put back still on the card? ────────
    const refunds = await tx.giftCardTxn.findMany({
        where:  { universalVoucherId: spineId, type: "REFUND" },
        select: { giftCardId: true, amount: true, giftCard: { select: { code: true, balance: true } } },
    });
    const cardNeed = new Map<number, { code: string; balance: number; need: number }>();
    for (const r of refunds) {
        const prev = cardNeed.get(r.giftCardId);
        cardNeed.set(r.giftCardId, {
            code:    r.giftCard.code,
            balance: toNumber(r.giftCard.balance),
            need:    round2((prev?.need ?? 0) + toNumber(r.amount)),
        });
    }
    for (const card of cardNeed.values()) {
        if (card.need - card.balance > 0.005) {
            conflicts.push({
                kind:    "GIFT_CARD",
                label:   card.code,
                message: `Gift card ${card.code} needs ₹${card.need.toFixed(2)} taken back but holds only ₹${round2(card.balance).toFixed(2)} — ₹${round2(card.need - card.balance).toFixed(2)} was already spent on another bill. Restoring will leave the card short.`,
            });
        }
    }

    // ── Coupon: does re-taking the freed slot cross the coupon's limit? ───────
    const reversed = await tx.couponRedemption.findMany({
        where:  { universalVoucherId: spineId, reversedAt: { not: null } },
        select: { couponId: true, accountId: true, coupon: { select: { name: true, totalUsageLimit: true, perCustomerLimit: true } } },
    });
    for (const [couponId, group] of groupBy(reversed, (r) => r.couponId)) {
        const coupon = group[0].coupon;
        const retaking = group.length;

        if (coupon.totalUsageLimit != null) {
            const live = await tx.couponRedemption.count({ where: { couponId, reversedAt: null } });
            if (live + retaking > coupon.totalUsageLimit) {
                conflicts.push({
                    kind:    "COUPON",
                    label:   coupon.name,
                    message: `Coupon "${coupon.name}" allows ${coupon.totalUsageLimit} use(s) and ${live} are already in use elsewhere. Restoring takes back ${retaking} more and puts it over its limit.`,
                });
                continue;
            }
        }
        if (coupon.perCustomerLimit != null && args.partyAccountId != null) {
            const live = await tx.couponRedemption.count({ where: { couponId, accountId: args.partyAccountId, reversedAt: null } });
            if (live + retaking > coupon.perCustomerLimit) {
                conflicts.push({
                    kind:    "COUPON",
                    label:   coupon.name,
                    message: `Coupon "${coupon.name}" allows ${coupon.perCustomerLimit} use(s) per customer and this customer already has ${live} elsewhere. Restoring puts them over that limit.`,
                });
            }
        }
    }

    // ── Loyalty: are the points the cancel gave back still unspent? ───────────
    if (args.partyAccountId != null) {
        const restored = await tx.loyaltyLedger.aggregate({
            where: { universalVoucherId: spineId, reason: "REVERSAL_RETURN", delta: { gt: 0 } },
            _sum:  { delta: true },
        });
        const points = restored._sum.delta ?? 0;
        if (points > 0) {
            // The lot cancel minted for those points — the newest on this spine
            // carrying exactly that many (the same pick the un-reversal makes).
            const lot = await tx.loyaltyLot.findFirst({
                where:   { accountId: args.partyAccountId, universalVoucherId: spineId, pointsEarned: points },
                orderBy: { id: "desc" },
                select:  { pointsRemaining: true },
            });
            const spent = points - (lot?.pointsRemaining ?? 0);
            if (lot && spent > 0) {
                conflicts.push({
                    kind:    "LOYALTY",
                    label:   `${points} points`,
                    message: `The cancel gave back ${points} loyalty point(s) and ${spent} of them have already been spent on another bill. Restoring takes the points back and can leave the customer's balance short.`,
                });
            }
        }
    }

    return conflicts;
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
    const out = new Map<K, T[]>();
    for (const row of rows) {
        const k = key(row);
        const bucket = out.get(k);
        if (bucket) bucket.push(row);
        else out.set(k, [row]);
    }
    return out;
}
