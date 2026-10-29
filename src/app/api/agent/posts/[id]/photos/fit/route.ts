import { NextResponse } from "next/server";
import { z } from "zod";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { CHANNEL_SPECS, photoCropSchema, photoFocusSchema } from "@/modules/campaigns/lib/post";
import { PhotoFitError, fitPostPhoto } from "@/modules/campaigns/lib/postPhotoFit";
import { ownOpenPost } from "@/modules/campaigns/lib/agentPosts";

/**
 * POST /api/agent/posts/:id/photos/fit — the Cowork agent looks at a photo and
 * says where the important part is; the server cuts it (our own sharp, free)
 * in the channel's shape and makes it that channel's photo.
 *   { channel, focus: { x, y }, zoom?, key? }   focus as fractions (0–1) across / down
 *   { channel, crop: { x, y, w, h }, key? }     or the exact frame, as fractions
 *   { fit: "all" }                               or the automatic cut for every channel
 * `key` = which of the post's photos (default the main one). Answer: { post, fitted }.
 */

const schema = z.union([
    z.object({
        channel: z.string().refine((c) => c in CHANNEL_SPECS, "Unknown channel"),
        focus: photoFocusSchema.optional(),
        crop: photoCropSchema.optional(),
        zoom: z.number().min(1).max(5).optional(),
        key: z.string().min(1).max(300).optional(),
    }),
    z.object({ fit: z.literal("all"), key: z.string().min(1).max(300).optional() }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!(await requireIncomingKey(req, "COWORK"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    const own = await ownOpenPost(id);
    if (own.error) return own.error;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        if ("fit" in data) return NextResponse.json(await fitPostPhoto(id, { sourceKey: data.key }));
        if (!data.focus && !data.crop) return NextResponse.json({ error: "Send focus { x, y } or crop { x, y, w, h }." }, { status: 400 });
        return NextResponse.json(
            await fitPostPhoto(id, { sourceKey: data.key, channels: [data.channel], focus: data.focus, crop: data.crop, zoom: data.zoom }),
        );
    } catch (e) {
        if (e instanceof PhotoFitError) return NextResponse.json({ error: e.message }, { status: 400 });
        return handleApiError(e, "Could not cut the photo");
    }
}
