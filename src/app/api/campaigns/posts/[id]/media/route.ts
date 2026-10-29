import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { checkPostMedia, type PostPhoto } from "@/modules/campaigns/lib/post";
import { loadPost, postMediaPrefix, postMediaResponse } from "@/modules/campaigns/lib/postServer";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * GET    /api/campaigns/posts/:id/media — the file itself, from our own site. A
 *        phone's share sheet needs the bytes, and the R2 bucket's CORS lets a
 *        page show a signed link but not read it from script. Only Share calls it.
 *        `?key=` picks one of the post's photos; none = the main one.
 * PUT    /api/campaigns/posts/:id/media — attach the file the browser just
 *        uploaded (via ./upload-url): as the main photo, or `extra` adds it to
 *        the photos channel copies can pick from.
 * DELETE /api/campaigns/posts/:id/media — take the main file off, or `?key=`
 *        one extra photo. The R2 object stays.
 */

const schema = z.object({
    key: z.string().trim().min(1).max(300),
    type: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    size: z.number().int().positive(),
    extra: z.boolean().optional(),
});

/** At most this many photos per post besides the main one (Instagram's carousel is 10). */
const EXTRA_MAX = 9;

const notFound = () => NextResponse.json({ error: "Post not found" }, { status: 404 });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    return postMediaResponse(id, new URL(req.url).searchParams.get("key"));
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
        const { extra, ...file } = data;
        if (extra) {
            const row = await prisma.post.findUnique({ where: { id }, select: { extraMedia: true } });
            if (!row) return notFound();
            const list = row.extraMedia as PostPhoto[];
            if (list.length >= EXTRA_MAX) return NextResponse.json({ error: `A post holds ${EXTRA_MAX + 1} photos at most.` }, { status: 400 });
            await prisma.post.update({ where: { id }, data: { extraMedia: [...list, file] } });
            return NextResponse.json(await loadPost(id));
        }
        const { count } = await prisma.post.updateMany({
            where: { id },
            data: { mediaKey: file.key, mediaType: file.type, mediaName: file.name, mediaSize: file.size },
        });
        if (count === 0) return notFound();
        return NextResponse.json(await loadPost(id));
    } catch (e) {
        return handleApiError(e, "Failed to attach the file");
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    try {
        const key = new URL(req.url).searchParams.get("key");
        if (key) {
            const row = await prisma.post.findUnique({ where: { id }, select: { extraMedia: true } });
            if (!row) return notFound();
            await prisma.post.update({ where: { id }, data: { extraMedia: (row.extraMedia as PostPhoto[]).filter((f) => f.key !== key) } });
            return NextResponse.json(await loadPost(id));
        }
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
