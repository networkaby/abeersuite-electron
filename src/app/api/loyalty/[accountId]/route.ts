import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// GET /api/loyalty/[accountId] — wallet summary + active lots + recent history.
// Read-only; the customer page that mounts <LoyaltyPanel> is already permission-gated.
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const accountId = Number((await params).accountId);
    if (!Number.isFinite(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const [wallet, lots, ledger] = await Promise.all([
            prisma.loyaltyAccount.findUnique({ where: { accountId } }),
            prisma.loyaltyLot.findMany({
                where: { accountId, status: "ACTIVE", pointsRemaining: { gt: 0 } },
                orderBy: { expiresAt: "asc" },
                select: { id: true, pointsRemaining: true, pointsEarned: true, earnedAt: true, expiresAt: true },
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

        return NextResponse.json({
            balance:       wallet?.pointsBalance ?? 0,
            totalEarned:   wallet?.totalEarned ?? 0,
            totalRedeemed: wallet?.totalRedeemed ?? 0,
            totalExpired:  wallet?.totalExpired ?? 0,
            lots,
            ledger,
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch loyalty wallet");
    }
}
