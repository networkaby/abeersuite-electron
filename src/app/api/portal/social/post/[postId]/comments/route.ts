import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { resolveSocialActors, resolveSocialActor, socialKey } from "@/shared/lib/social/socialActor";

// GET/POST /api/portal/social/post/[postId]/comments — read or add comments on a
// post. Comment authors are resolved SocialActors (staff or customer).

export async function GET(_: Request, { params }: { params: Promise<{ postId: string }> }) {
    const { response } = await requirePortalCustomer();
    if (response) return response;

    const postId = Number((await params).postId);
    if (!Number.isFinite(postId)) return NextResponse.json({ error: "Invalid post" }, { status: 400 });

    try {
        const rows = await prisma.wallPostComment.findMany({
            where:   { postId },
            orderBy: { createdAt: "asc" },
            select:  { id: true, body: true, createdAt: true, authorKind: true, authorId: true },
        });
        const actors = await resolveSocialActors(rows.map((r) => ({ kind: r.authorKind, id: r.authorId })));
        const comments = rows.map((r) => ({
            id: r.id, body: r.body, createdAt: r.createdAt,
            author: actors.get(socialKey(r.authorKind, r.authorId))!,
        }));
        return NextResponse.json(comments);
    } catch (e) {
        return handleApiError(e, "Failed to load comments");
    }
}

const commentSchema = z.object({ body: z.string().trim().min(1, "Comment is required").max(1000, "Max 1000 characters") });

export async function POST(req: Request, { params }: { params: Promise<{ postId: string }> }) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const postId = Number((await params).postId);
    if (!Number.isFinite(postId)) return NextResponse.json({ error: "Invalid post" }, { status: 400 });

    const post = await prisma.wallPost.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const { data, error } = await validateRequest(req, commentSchema);
    if (error) return error;

    try {
        const row = await prisma.wallPostComment.create({
            data:   { postId, authorKind: "PERSON", authorId: customerId!, body: data.body },
            select: { id: true, body: true, createdAt: true, authorKind: true, authorId: true },
        });
        const author = await resolveSocialActor({ kind: row.authorKind, id: row.authorId });
        return NextResponse.json({ id: row.id, body: row.body, createdAt: row.createdAt, author }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to comment");
    }
}
