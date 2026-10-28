import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { FacebookError, disconnectFacebook, facebookStatus, pickFacebookPage } from "@/modules/campaigns/lib/facebookPage";
import { requireFacebookConnect, requireFacebookStatus } from "@/modules/campaigns/lib/campaignAccess";

/**
 * The shop's Facebook Page connection (Campaigns → Channels).
 * GET    — status, never a token.
 * PUT    — { pageId } the page posts go to; its token is read server side.
 * DELETE — disconnect (Facebook is told to drop the access too).
 */

export async function GET() {
    const { response } = await requireFacebookStatus();
    if (response) return response;
    try {
        return NextResponse.json(await facebookStatus());
    } catch (e) {
        return handleApiError(e, "Failed to load the Facebook connection");
    }
}

const pickSchema = z.object({ pageId: z.string().regex(/^\d{1,30}$/) });

export async function PUT(req: Request) {
    const { response } = await requireFacebookConnect();
    if (response) return response;
    const { data, error } = await validateRequest(req, pickSchema);
    if (error) return error;
    try {
        if (!(await facebookStatus()).connected) return NextResponse.json({ error: "Connect Facebook first." }, { status: 409 });
        const problem = await pickFacebookPage(data.pageId);
        if (problem) return NextResponse.json({ error: problem }, { status: 422 });
        return NextResponse.json(await facebookStatus());
    } catch (e) {
        if (e instanceof FacebookError) return NextResponse.json({ error: e.message }, { status: 502 });
        return handleApiError(e, "Failed to save the page");
    }
}

export async function DELETE() {
    const { response } = await requireFacebookConnect();
    if (response) return response;
    try {
        await disconnectFacebook();
        return NextResponse.json(await facebookStatus());
    } catch (e) {
        return handleApiError(e, "Failed to disconnect");
    }
}
