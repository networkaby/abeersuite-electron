import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { CAMPAIGN_SELECT, campaignSchema } from "@/modules/campaigns/lib/campaign";
import { requireCampaignsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * PATCH  /api/campaigns/:id — save changes. A sent campaign is history: locked.
 *        A scheduled one keeps its status and time; only its content changes.
 * DELETE /api/campaigns/:id — remove a draft or ready one; a sent one stays.
 */

const locked = () => NextResponse.json({ error: "This campaign was sent; it can no longer change." }, { status: 409 });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireCampaignsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, campaignSchema);
    if (error) return error;

    try {
        const cur = await prisma.campaign.findUnique({ where: { id }, select: { status: true } });
        if (!cur) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
        // A scheduled campaign stays scheduled through an edit; Schedule / Cancel move it.
        const { status, ...fields } = data;
        const { count } = await prisma.campaign.updateMany({
            where: { id, status: cur.status === "SCHEDULED" ? "SCHEDULED" : { notIn: ["SENT", "SCHEDULED"] } },
            data: cur.status === "SCHEDULED" ? fields : { ...fields, status },
        });
        if (count === 0) return locked();
        const row = await prisma.campaign.findUnique({ where: { id }, select: CAMPAIGN_SELECT });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to save the campaign");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireCampaignsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    try {
        const { count } = await prisma.campaign.deleteMany({ where: { id, status: { not: "SENT" } } });
        if (count === 0) {
            const exists = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
            return exists ? locked() : NextResponse.json({ error: "Campaign not found" }, { status: 404 });
        }
        return new NextResponse(null, { status: 204 });
    } catch (e) {
        return handleApiError(e, "Failed to delete the campaign");
    }
}
