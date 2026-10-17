import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { CAMPAIGN_SELECT, campaignSchema } from "@/modules/campaigns/lib/campaign";
import { requireCampaignsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * GET  /api/campaigns — every campaign, newest first (a short list: one per
 *      greeting / offer, so no paging yet).
 * POST /api/campaigns — save a new one. Writing rides the Campaigns sidebar
 *      link; sending is `campaigns:send` (phase 2).
 */

export async function GET() {
    const { response } = await requireCampaignsPage();
    if (response) return response;

    const rows = await prisma.campaign.findMany({ select: CAMPAIGN_SELECT, orderBy: { createdAt: "desc" } });
    return NextResponse.json(rows);
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
