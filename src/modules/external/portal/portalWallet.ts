import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { expiryCutoff, liveBalance, ratesFromConfig } from "@/modules/loyalty/lib";

export type PortalWallet = {
    /** False when the shop has loyalty switched off — the screen says so instead of showing 0. */
    loyaltyOn: boolean;
    points: number;
    /** What the points are worth at the counter / checkout (₹). */
    pointsValue: number;
    totalEarned: number;
    totalRedeemed: number;
    /** The soonest batch of points that will lapse, if expiry is on. */
    nextExpiry: { points: number; on: string } | null;
    history: { id: number; delta: number; label: string; reference: string | null; at: string }[];
    giftCards: { id: number; last4: string; balance: number; expiresAt: string | null }[];
};

const REASON_LABEL: Record<string, string> = {
    EARN_SALE: "Earned on a purchase",
    REDEEM_SALE: "Used on a purchase",
    REVERSAL_RETURN: "Returned goods",
    ADMIN_ADJUST: "Adjusted by the shop",
    MILESTONE_BONUS: "Milestone bonus",
};

async function compute(accountId: number): Promise<PortalWallet> {
    // Read only — a customer screen never creates the config row (the staff
    // loyalty page does). No row yet = loyalty has never been set up = off.
    const config = await prisma.loyaltyConfig.findUnique({ where: { id: 1 } });
    const rates = config ? ratesFromConfig(config) : null;
    const now = new Date();
    const cutoff = rates ? expiryCutoff(now, rates) : null;

    const [wallet, soonest, ledger, cards, points] = await Promise.all([
        prisma.loyaltyAccount.findUnique({ where: { accountId }, select: { totalEarned: true, totalRedeemed: true } }),
        rates?.expiryEnabled
            ? prisma.loyaltyLot.findFirst({
                  where: { accountId, pointsRemaining: { gt: 0 }, ...(cutoff ? { earnedAt: { gt: cutoff } } : {}) },
                  orderBy: { earnedAt: "asc" },
                  select: { pointsRemaining: true, earnedAt: true },
              })
            : null,
        prisma.loyaltyLedger.findMany({
            where: { accountId },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: { id: true, delta: true, reason: true, createdAt: true, universalVoucher: { select: { id: true, voucherNo: true } } },
        }),
        prisma.giftCard.findMany({
            where: { ownerAccountId: accountId, status: "ACTIVE", enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            orderBy: { issuedAt: "desc" },
            select: { id: true, code: true, balance: true, expiresAt: true },
        }),
        rates ? liveBalance(prisma, accountId, rates) : 0,
    ]);

    return {
        loyaltyOn: !!rates?.enabled,
        points,
        pointsValue: rates ? Math.max(0, points) * rates.redeemValue : 0,
        totalEarned: wallet?.totalEarned ?? 0,
        totalRedeemed: wallet?.totalRedeemed ?? 0,
        nextExpiry:
            soonest && rates
                ? { points: soonest.pointsRemaining, on: new Date(soonest.earnedAt.getTime() + rates.expiryDays * 86_400_000).toISOString() }
                : null,
        history: ledger.map((l) => ({
            id: l.id,
            delta: l.delta,
            label: REASON_LABEL[l.reason] ?? l.reason,
            reference: l.universalVoucher ? (l.universalVoucher.voucherNo ?? formatUvNo(l.universalVoucher.id)) : null,
            at: l.createdAt.toISOString(),
        })),
        // The full code is the card itself — only its last four digits are shown.
        giftCards: cards.map((c) => ({ id: c.id, last4: c.code.slice(-4), balance: Number(c.balance), expiresAt: c.expiresAt?.toISOString() ?? null })),
    };
}

/**
 * One profile's wallet — loyalty points (live balance under the current expiry
 * window, what they are worth, the next batch to lapse, the history) and the gift
 * cards it owns. Kept a minute per profile; the portal's My Wallet and the
 * customer app both read it.
 */
export const loadPortalWallet = unstable_cache(compute, ["portal:wallet"], { revalidate: 60 });
