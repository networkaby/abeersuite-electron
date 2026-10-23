import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { recordShare } from "@/modules/campaigns/lib/postServer";
import { PHONE_POST_CHANNELS } from "@/modules/mobile/lib/mobilePosts";

/**
 * POST /api/mobile/posts/:id/shares — { channel } — the staff app's Done: this
 * person put the post up on WhatsApp Channel / Status. Only the WhatsApp
 * channels; the post turns DONE once every channel it is meant for is shared.
 */
const schema = z.object({ channel: z.enum(PHONE_POST_CHANNELS) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.MOBILE_POSTS_SHARE);
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const row = await recordShare(id, data.channel, user.id);
        return row ? NextResponse.json(row) : NextResponse.json({ error: "Post not found" }, { status: 404 });
    } catch (e) {
        return handleApiError(e, "Failed to save");
    }
}
