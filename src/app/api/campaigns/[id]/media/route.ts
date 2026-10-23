import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { CAMPAIGN_SELECT, checkCampaignMedia } from "@/modules/campaigns/lib/campaign";
import { requireCampaignsPage } from "@/modules/campaigns/lib/campaignAccess";
import { campaignMediaPrefix, withMediaLinks } from "@/modules/campaigns/lib/campaignMedia";
import { mediaLink } from "@/modules/message/lib/customerMessages";

/**
 * GET    /api/campaigns/:id/media — the file itself, from our own site. The
 *        phone's share sheet needs the bytes, and the R2 bucket's CORS lets a
 *        page show a signed link but not read it from script; this route has no
 *        such limit. Only Share calls it (≤ 16 MB, now and then).
 * PUT    /api/campaigns/:id/media — attach the photo / video the browser just
 *        uploaded (via ./upload-url). Allowed on a sent campaign too: its push
 *        went long ago, the Status / Channel post can still come after.
 * DELETE /api/campaigns/:id/media — take the file off the campaign. The R2
 *        object stays behind (a few MB, private), like a replaced chat file.
 */

const schema = z.object({
    key: z.string().trim().min(1).max(300),
    type: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    size: z.number().int().positive(),
});

const notFound = () => NextResponse.json({ error: "Campaign not found" }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireCampaignsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const c = await prisma.campaign.findUnique({ where: { id }, select: { mediaKey: true, mediaType: true } });
    if (!c?.mediaKey) return NextResponse.json({ error: "This campaign has no photo or video." }, { status: 404 });
    const link = mediaLink(c.mediaKey);
    if (!link) return NextResponse.json({ error: "File storage (R2) is not set up on this server." }, { status: 503 });

    const file = await fetch(link);
    if (!file.ok || !file.body) return NextResponse.json({ error: `Could not read the file (${file.status})` }, { status: 502 });
    return new NextResponse(file.body, {
        headers: { "Content-Type": c.mediaType ?? "application/octet-stream", "Cache-Control": "private, max-age=300" },
    });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireCampaignsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    if (!data.key.startsWith(campaignMediaPrefix(id))) return NextResponse.json({ error: "That file does not belong to this campaign." }, { status: 400 });
    const bad = checkCampaignMedia(data.type, data.size);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });

    try {
        const { count } = await prisma.campaign.updateMany({
            where: { id },
            data: { mediaKey: data.key, mediaType: data.type, mediaName: data.name, mediaSize: data.size },
        });
        if (count === 0) return notFound();
        const row = await prisma.campaign.findUnique({ where: { id }, select: CAMPAIGN_SELECT });
        return NextResponse.json(row && withMediaLinks(row));
    } catch (e) {
        return handleApiError(e, "Failed to attach the file");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireCampaignsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    try {
        const { count } = await prisma.campaign.updateMany({
            where: { id },
            data: { mediaKey: null, mediaType: null, mediaName: null, mediaSize: null },
        });
        if (count === 0) return notFound();
        const row = await prisma.campaign.findUnique({ where: { id }, select: CAMPAIGN_SELECT });
        return NextResponse.json(row && withMediaLinks(row));
    } catch (e) {
        return handleApiError(e, "Failed to remove the file");
    }
}
