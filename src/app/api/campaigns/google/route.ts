import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { GOOGLE_LINK_ID, disconnectGoogle, googleStatus } from "@/modules/campaigns/lib/googleBusiness";
import { requireGoogleConnect, requireGoogleStatus } from "@/modules/campaigns/lib/campaignAccess";

/**
 * The shop's Google Business Profile connection (Campaigns → Channels).
 * GET    — status, never the token.
 * PUT    — { accountName, locationName, locationTitle } the listing posts go to.
 * DELETE — disconnect (Google is told to drop the access too).
 */

export async function GET() {
    const { response } = await requireGoogleStatus();
    if (response) return response;
    try {
        return NextResponse.json(await googleStatus());
    } catch (e) {
        return handleApiError(e, "Failed to load the Google connection");
    }
}

const pickSchema = z.object({
    accountName: z.string().regex(/^accounts\/[\w-]+$/),
    locationName: z.string().regex(/^locations\/[\w-]+$/),
    locationTitle: z.string().trim().min(1).max(200),
});

export async function PUT(req: Request) {
    const { response } = await requireGoogleConnect();
    if (response) return response;
    const { data, error } = await validateRequest(req, pickSchema);
    if (error) return error;
    try {
        const { count } = await prisma.googleBusinessLink.updateMany({ where: { id: GOOGLE_LINK_ID }, data: { ...data, lastError: null } });
        if (!count) return NextResponse.json({ error: "Connect Google first." }, { status: 409 });
        return NextResponse.json(await googleStatus());
    } catch (e) {
        return handleApiError(e, "Failed to save the listing");
    }
}

export async function DELETE() {
    const { response } = await requireGoogleConnect();
    if (response) return response;
    try {
        await disconnectGoogle();
        return NextResponse.json(await googleStatus());
    } catch (e) {
        return handleApiError(e, "Failed to disconnect");
    }
}
