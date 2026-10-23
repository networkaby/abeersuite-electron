import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { R2_MESSAGES_BUCKET } from "@/shared/lib/constants/whatsapp";
import { isR2Configured, presignR2 } from "@/shared/lib/storage/r2";
import { checkPostMedia } from "@/modules/campaigns/lib/post";
import { postMediaKey } from "@/modules/campaigns/lib/postServer";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";

// POST /api/campaigns/posts/:id/media/upload-url — { name, type, size } → { key, putUrl }.
// A 10-minute signed PUT into private R2, so the browser uploads the photo
// straight to storage. Saves nothing: PUT ../media then attaches `key` (only
// keys under this post's prefix are accepted).

const schema = z.object({
    name: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(100),
    size: z.number().int().positive(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        if (!isR2Configured()) return NextResponse.json({ error: "File storage (R2) is not set up on this server." }, { status: 503 });
        const bad = checkPostMedia(data.type, data.size);
        if (bad) return NextResponse.json({ error: bad }, { status: 400 });
        if (!(await prisma.post.findUnique({ where: { id }, select: { id: true } }))) {
            return NextResponse.json({ error: "Post not found" }, { status: 404 });
        }

        const key = postMediaKey(id, data.name);
        const putUrl = presignR2({ bucket: R2_MESSAGES_BUCKET, key, method: "PUT", contentType: data.type, expiresSec: 600 });
        return NextResponse.json({ key, putUrl });
    } catch (e) {
        return handleApiError(e, "Could not prepare the upload");
    }
}
