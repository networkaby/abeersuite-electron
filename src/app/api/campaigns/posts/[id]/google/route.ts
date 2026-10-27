import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { GoogleError } from "@/modules/campaigns/lib/googleBusiness";
import { sendPostToGoogle } from "@/modules/campaigns/lib/googlePosts";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * POST /api/campaigns/posts/:id/google — { again? } — put the post up on the
 * shop's Google Business Profile now, through Google's API, and log the share.
 * `again` posts one already shared there once more.
 */

const schema = z.object({ again: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const done = await sendPostToGoogle(id, { userId: user.id }, data.again ?? false);
        return done ? NextResponse.json(done) : NextResponse.json({ error: "Post not found" }, { status: 404 });
    } catch (e) {
        if (e instanceof GoogleError) return NextResponse.json({ error: e.message }, { status: 422 });
        return handleApiError(e, "Failed to post to Google");
    }
}
