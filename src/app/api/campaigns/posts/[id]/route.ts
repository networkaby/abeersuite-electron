import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { postSchema } from "@/modules/campaigns/lib/post";
import { loadPost } from "@/modules/campaigns/lib/postServer";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * GET    /api/campaigns/posts/:id — one post, with its file links and shares.
 * PATCH  /api/campaigns/posts/:id — save changes. A done post can still be
 *        edited (staff fix a typo before sharing it again).
 * POST   /api/campaigns/posts/:id — schedule a timed draft as it stands. A new
 *        post is saved as a draft until its photos are in, then this, so no
 *        job can send it without them.
 * DELETE /api/campaigns/posts/:id — remove it with its share lines. The R2 file
 *        stays behind (a few MB, private), like a replaced chat attachment.
 */

const notFound = () => NextResponse.json({ error: "Post not found" }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    const row = await loadPost(id);
    return row ? NextResponse.json(row) : notFound();
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, postSchema);
    if (error) return error;

    try {
        // Saving a done post keeps it done; only a draft / scheduled one takes the new status.
        const current = await prisma.post.findUnique({ where: { id }, select: { status: true } });
        if (!current) return notFound();
        await prisma.post.update({ where: { id }, data: { ...data, status: current.status === "DONE" ? "DONE" : data.status } });
        return NextResponse.json(await loadPost(id));
    } catch (e) {
        return handleApiError(e, "Failed to save the post");
    }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    try {
        // Only a timed draft moves; the photos, variants and times stay exactly as saved.
        const { count } = await prisma.post.updateMany({ where: { id, status: "DRAFT", scheduledAt: { not: null } }, data: { status: "SCHEDULED" } });
        if (count === 0) return NextResponse.json({ error: "Only a draft with a time can be scheduled." }, { status: 400 });
        return NextResponse.json(await loadPost(id));
    } catch (e) {
        return handleApiError(e, "Failed to schedule the post");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    try {
        const { count } = await prisma.post.deleteMany({ where: { id } });
        if (count === 0) return notFound();
        return new NextResponse(null, { status: 204 });
    } catch (e) {
        return handleApiError(e, "Failed to delete the post");
    }
}
