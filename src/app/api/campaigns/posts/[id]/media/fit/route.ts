import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";
import { PhotoFitError, fitChannelPhotos, fitPostPhoto } from "@/modules/campaigns/lib/postPhotoFit";
import { photoCropSchema, photoFocusSchema } from "@/modules/campaigns/lib/post";

// POST /api/campaigns/posts/:id/media/fit { key?, channels?, crop?, focus?, zoom? }
// — cut the post's photo (`key`, default the main one) to each channel's best
// shape and make it that channel's photo (postPhotoFit.ts). No `channels` =
// every ticked one. `crop` (the Adjust editor's frame) or `focus` + `zoom`:
// exactly that part, for one channel.
// Answer: { post, fitted: { CHANNEL: key } }.

const schema = z.object({
    key: z.string().trim().min(1).max(300).nullish(),
    channels: z.array(z.string().min(1).max(40)).max(10).nullish(),
    crop: photoCropSchema.nullish(),
    focus: photoFocusSchema.nullish(),
    zoom: z.number().min(1).max(5).nullish(),
    // Several photos for one channel, in order (Facebook feed's multi-photo post).
    keys: z.array(z.string().min(1).max(300)).min(1).max(10).nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        if (data.keys) {
            if (data.channels?.length !== 1) return NextResponse.json({ error: "Several photos are for one channel at a time." }, { status: 400 });
            return NextResponse.json(await fitChannelPhotos(id, data.channels[0], data.keys));
        }
        return NextResponse.json(await fitPostPhoto(id, { sourceKey: data.key, channels: data.channels, crop: data.crop, focus: data.focus, zoom: data.zoom }));
    } catch (e) {
        if (e instanceof PhotoFitError) return NextResponse.json({ error: e.message }, { status: 400 });
        return handleApiError(e, "Could not fit the photo");
    }
}
