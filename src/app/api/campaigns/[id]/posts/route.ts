import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { CAMPAIGN_POST_PLACES, CAMPAIGN_SELECT } from "@/modules/campaigns/lib/campaign";
import { requireCampaignsPage } from "@/modules/campaigns/lib/campaignAccess";
import { withMediaLinks } from "@/modules/campaigns/lib/campaignMedia";

/**
 * POST /api/campaigns/:id/posts — { place } — staff mark that they put this
 * campaign up on WhatsApp Status or a Channel by hand (Meta has no API for
 * either). A log line only; the same place can be posted again another day.
 */

const schema = z.object({
    place: z.enum(CAMPAIGN_POST_PLACES.map((p) => p.value) as [string, ...string[]]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireCampaignsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        if (!(await prisma.campaign.findUnique({ where: { id }, select: { id: true } }))) {
            return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
        }
        const me = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
        await prisma.campaignPost.create({
            data: { campaignId: id, place: data.place, postedById: user.id, postedByName: me?.name ?? null },
        });
        const row = await prisma.campaign.findUnique({ where: { id }, select: CAMPAIGN_SELECT });
        return NextResponse.json(row && withMediaLinks(row));
    } catch (e) {
        return handleApiError(e, "Failed to save the post");
    }
}
