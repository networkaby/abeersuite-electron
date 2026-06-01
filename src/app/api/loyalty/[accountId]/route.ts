import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { ratesFromConfig, liveBalance, expiryCutoff } from "@/modules/loyalty/lib";

// GET /api/loyalty/[accountId] — wallet summary + active (in-window) lots + history.
// Balance is computed LIVE under the current expiry window. Read-only; the customer
// page that mounts <LoyaltyPanel> is already permission-gated.
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const accountId = Number((await params).accountId);
    if (!Number.isFinite(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const config = await prisma.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        const rates = ratesFromConfig(config);
        const cutoff = expiryCutoff(new Date(), rates);

        const [wallet, lots, ledger] = await Promise.all([
            prisma.loyaltyAccount.findUnique({ where: { accountId } }),
            prisma.loyaltyLot.findMany({
                where: { accountId, pointsRemaining: { gt: 0 }, ...(cutoff ? { earnedAt: { gt: cutoff } } : {}) },
                orderBy: { earnedAt: "asc" },
                select: { id: true, pointsRemaining: true, pointsEarned: true, earnedAt: true },
            }),
            prisma.loyaltyLedger.findMany({
                where: { accountId },
                orderBy: { createdAt: "desc" },
                take: 50,
                select: {
                    id: true, delta: true, reason: true, balanceAfter: true, note: true, createdAt: true,
                    voucher: { select: { id: true, reference: true } },
                },
            }),
        ]);

        const balance = await liveBalance(prisma, accountId, rates);
        // Each in-window lot's display expiry = earnedAt + expiryDays (null if expiry off).
        const lotsOut = lots.map((l) => ({
            ...l,
            expiresAt: rates.expiryEnabled ? new Date(new Date(l.earnedAt).getTime() + rates.expiryDays * 86_400_000) : null,
        }));

        return NextResponse.json({
            balance,
            value:         balance * rates.redeemValue,   // memo ₹ worth of the balance
            totalEarned:   wallet?.totalEarned ?? 0,
            totalRedeemed: wallet?.totalRedeemed ?? 0,
            lots: lotsOut,
            ledger,
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch loyalty wallet");
    }
}
