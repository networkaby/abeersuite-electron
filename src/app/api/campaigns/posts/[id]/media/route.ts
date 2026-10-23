import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { checkPostMedia } from "@/modules/campaigns/lib/post";
import { loadPost, postMediaPrefix, postMediaResponse } from "@/modules/campaigns/lib/postServer";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * GET    /api/campaigns/posts/:id/media — the file itself, from our own site. A
 *        phone's share sheet needs the bytes, and the R2 bucket's CORS lets a
 *        page show a signed link but not read it from script. Only Share calls it.
 * PUT    /api/campaigns/posts/:id/media — attach the file the browser just
 *        uploaded (via ./upload-url).
 * DELETE /api/campaigns/posts/:id/media — take the file off. The R2 object stays.
 */

const schema = z.object({
    key: z.string().trim().min(1).max(300),
    type: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    size: z.number().int().positive(),
});

const notFound = () => NextResponse.json({ error: "Post not found" }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    return postMediaResponse(id);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    if (!data.key.startsWith(postMediaPrefix(id))) return NextResponse.json({ error: "That file does not belong to this post." }, { status: 400 });
    const bad = checkPostMedia(data.type, data.size);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });

    try {
        const { count } = await prisma.post.updateMany({
            where: { id },
            data: { mediaKey: data.key, mediaType: data.type, mediaName: data.name, mediaSize: data.size },
        });
        if (count === 0) return notFound();
        return NextResponse.json(await loadPost(id));
    } catch (e) {
        return handleApiError(e, "Failed to attach the file");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    try {
        const { count } = await prisma.post.updateMany({
            where: { id },
            data: { mediaKey: null, mediaType: null, mediaName: null, mediaSize: null },
        });
        if (count === 0) return notFound();
        return NextResponse.json(await loadPost(id));
    } catch (e) {
        return handleApiError(e, "Failed to remove the file");
    }
}
