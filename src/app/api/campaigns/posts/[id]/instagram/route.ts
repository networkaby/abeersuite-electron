import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { FacebookError } from "@/modules/campaigns/lib/facebookPage";
import { isInstagramChannel, sendPostToInstagram } from "@/modules/campaigns/lib/instagram";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";

// A video is processed by Instagram before it can be published — allow for the wait.
export const maxDuration = 120;

/**
 * POST /api/campaigns/posts/:id/instagram — { again?, channel? } — put the post
 * up on the Instagram account linked to the shop's Facebook Page now, and log
 * the share: the feed (default), its stories (INSTAGRAM_STORY) or a reel
 * (INSTAGRAM_REEL). `again` posts one already shared there once more.
 */

const schema = z.object({ again: z.boolean().optional(), channel: z.string().refine(isInstagramChannel, "Not an Instagram channel").optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const done = await sendPostToInstagram(id, { userId: user.id }, data.again ?? false, data.channel);
        return done ? NextResponse.json(done) : NextResponse.json({ error: "Post not found" }, { status: 404 });
    } catch (e) {
        if (e instanceof FacebookError) return NextResponse.json({ error: e.message }, { status: 422 });
        return handleApiError(e, "Failed to post to Instagram");
    }
}
