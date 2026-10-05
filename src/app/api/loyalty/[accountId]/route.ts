import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
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
                // Owed points (a negative lot, see liveBalance) show too — they never expire.
                where: {
                    accountId,
                    OR: [
                        { pointsRemaining: { gt: 0 }, ...(cutoff ? { earnedAt: { gt: cutoff } } : {}) },
                        { pointsRemaining: { lt: 0 } },
                    ],
                },
                orderBy: { earnedAt: "asc" },
                select: { id: true, pointsRemaining: true, pointsEarned: true, earnedAt: true },
            }),
            prisma.loyaltyLedger.findMany({
                where: { accountId },
                orderBy: { createdAt: "desc" },
                take: 50,
                select: {
                    id: true, delta: true, reason: true, balanceAfter: true, note: true, createdAt: true,
                    // Phase 5 5B: the linked document is the spine; aliased to `voucher`
                    // below so the wire shape the loyalty UI consumes is unchanged.
                    universalVoucher: { select: { id: true, voucherNo: true } },
                },
            }),
        ]);

        const balance = await liveBalance(prisma, accountId, rates);
        // Each in-window lot's display expiry = earnedAt + expiryDays (null if expiry off).
        const lotsOut = lots.map((l) => ({
            ...l,
            expiresAt: rates.expiryEnabled && l.pointsRemaining > 0 ? new Date(new Date(l.earnedAt).getTime() + rates.expiryDays * 86_400_000) : null,
        }));

        return NextResponse.json({
            balance,
            value:         balance * rates.redeemValue,   // memo ₹ worth of the balance
            totalEarned:   wallet?.totalEarned ?? 0,
            totalRedeemed: wallet?.totalRedeemed ?? 0,
            lots: lotsOut,
            ledger: ledger.map(({ universalVoucher, ...row }) => ({ ...row, voucher: universalVoucher ? { id: universalVoucher.id, reference: universalVoucher.voucherNo ?? formatUvNo(universalVoucher.id) } : null })),
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch loyalty wallet");
    }
}
