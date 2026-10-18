import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireCampaignsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * GET /api/campaigns/options — what the editor offers:
 * - coupons a campaign may carry: active, typed by code, not tied to one
 *   customer, not expired. Picked only — the Retention pages own them.
 * - audience size: devices and customers with notifications on right now.
 */
export async function GET() {
    const { response } = await requireCampaignsPage();
    if (response) return response;

    const now = new Date();
    const [coupons, devices, customers] = await Promise.all([
        prisma.coupon.findMany({
            where: {
                isActive: true,
                code: { not: null },
                ownerAccountId: null,
                OR: [{ endsAt: null }, { endsAt: { gt: now } }],
            },
            select: { id: true, code: true, name: true, endsAt: true },
            orderBy: { name: "asc" },
        }),
        prisma.pushSubscription.count(),
        prisma.pushSubscription.groupBy({ by: ["personId"] }).then((g) => g.length),
    ]);

    return NextResponse.json({ coupons, audience: { ALL_PUSH: { devices, customers } } });
}
