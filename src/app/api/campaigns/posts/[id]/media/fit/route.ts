import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";
import { PhotoFitError, fitPostPhoto } from "@/modules/campaigns/lib/postPhotoFit";

// POST /api/campaigns/posts/:id/media/fit { key?, channels? } — cut the post's
// photo (`key`, default the main one) to each channel's best shape and make it
// that channel's photo (postPhotoFit.ts). No `channels` = every ticked one.
// Answer: { post, fitted: { CHANNEL: key } }.

const schema = z.object({
    key: z.string().trim().min(1).max(300).nullish(),
    channels: z.array(z.string().min(1).max(40)).max(10).nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        return NextResponse.json(await fitPostPhoto(id, { sourceKey: data.key, channels: data.channels }));
    } catch (e) {
        if (e instanceof PhotoFitError) return NextResponse.json({ error: e.message }, { status: 400 });
        return handleApiError(e, "Could not fit the photo");
    }
}
