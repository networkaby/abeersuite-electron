import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { CAMPAIGN_SELECT, campaignSchema } from "@/modules/campaigns/lib/campaign";
import { requireCampaignsPage } from "@/modules/campaigns/lib/campaignAccess";
import { campaignStats } from "@/modules/campaigns/lib/sendCampaign";import { hasPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

/**
 * GET  /api/campaigns — every campaign, newest first (a short list: one per
 *      greeting / offer, so no paging yet), with each sent one's results and
 *      whether this user may send.
 * POST /api/campaigns — save a new one. Writing rides the Campaigns sidebar
 *      link; sending is `campaigns:send` (phase 2).
 */

export async function GET() {
    const { user, response } = await requireCampaignsPage();
    if (response) return response;

    const rows = await prisma.campaign.findMany({ select: CAMPAIGN_SELECT, orderBy: { createdAt: "desc" } });
    const stats = await campaignStats(rows.filter((r) => r.status === "SENT").map((r) => r.id));
    return NextResponse.json({
        // A sent campaign that reached nobody still shows its (zero) results.
        campaigns: rows.map((r) => ({ ...r, stats: stats[r.id] ?? (r.status === "SENT" ? { customers: 0, reached: 0, shown: 0, tapped: 0 } : null) })),
        canSend: hasPermission(user, PERMISSIONS.CAMPAIGNS_SEND),
    });
}

export async function POST(req: Request) {
    const { user, response } = await requireCampaignsPage();
    if (response) return response;

    const { data, error } = await validateRequest(req, campaignSchema);
    if (error) return error;

    try {
        const row = await prisma.campaign.create({
            data: { ...data, createdById: user.id },
            select: CAMPAIGN_SELECT,
        });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to save the campaign");
    }
}
