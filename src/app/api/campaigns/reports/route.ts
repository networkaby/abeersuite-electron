import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";
import { campaignStats } from "@/modules/campaigns/lib/sendCampaign";

/**
 * GET /api/campaigns/reports — the last 30 days, counted from what we already
 * store: posts put up per channel (auto vs by hand), each campaign sent with its
 * push results, and how often its coupon was used. A handful of grouped queries,
 * never one per row. Outside numbers (Google views, Channel followers) are not here.
 */

const DAYS = 30;

export async function GET() {
    const { response } = await requireAnyPermission(sidebarChildPermissionId("campaigns", "reports"));
    if (response) return response;

    const since = new Date(Date.now() - DAYS * 864e5);
    const [shares, campaigns] = await Promise.all([
        prisma.postShare.groupBy({
            by: ["channel", "sharedById"],
            where: { sharedAt: { gte: since } },
            _count: { _all: true },
        }),
        prisma.campaign.findMany({
            where: { status: "SENT", sentAt: { gte: since } },
            select: { id: true, name: true, sentAt: true, couponId: true, coupon: { select: { code: true } } },
            orderBy: { sentAt: "desc" },
        }),
    ]);

    const couponIds = [...new Set(campaigns.map((c) => c.couponId).filter((id): id is number => id != null))];
    const [stats, redemptions] = await Promise.all([
        campaignStats(campaigns.map((c) => c.id)),
        couponIds.length
            ? prisma.couponRedemption.groupBy({
                  by: ["couponId"],
                  // Same 30-day window; a coupon also used off-campaign is counted here too.
                  where: { couponId: { in: couponIds }, reversedAt: null, redeemedAt: { gte: since } },
                  _count: { _all: true },
                  _sum: { amount: true },
              })
            : Promise.resolve([]),
    ]);
    const used = new Map(redemptions.map((r) => [r.couponId, { uses: r._count._all, discount: Number(r._sum.amount ?? 0) }]));

    // A share with no staff id is the automatic job (Google / Facebook / Instagram).
    const channels: Record<string, { auto: number; byHand: number }> = {};
    for (const s of shares) {
        const row = (channels[s.channel] ??= { auto: 0, byHand: 0 });
        row[s.sharedById == null ? "auto" : "byHand"] += s._count._all;
    }

    return NextResponse.json(
        {
            days: DAYS,
            channels,
            campaigns: campaigns.map((c) => ({
                id: c.id,
                name: c.name,
                sentAt: c.sentAt,
                coupon: c.coupon?.code ?? null,
                stats: stats[c.id] ?? { customers: 0, reached: 0, shown: 0, tapped: 0 },
                couponUse: c.couponId != null ? (used.get(c.couponId) ?? { uses: 0, discount: 0 }) : null,
            })),
        },
        { headers: { "Cache-Control": "private, max-age=300" } },
    );
}
