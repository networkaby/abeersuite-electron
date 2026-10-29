import { parseIdParam } from "@/shared/lib/api";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { postMediaResponse } from "@/modules/campaigns/lib/postServer";

/** GET /api/mobile/posts/:id/media — the post's photo / video bytes (`?key=` one of its photos), for the phone's share. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.MOBILE_POSTS_SHARE);
    if (response) return response;
    const { id, error } = await parseIdParam(params);
    if (error) return error;
    return postMediaResponse(id, new URL(req.url).searchParams.get("key"));
}
