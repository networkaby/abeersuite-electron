import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { z } from "zod";
import { handleApiError } from "@/shared/lib/api";
import { resolveSocialActors, resolveSocialActor, socialKey } from "@/shared/lib/social/socialActor";

// Staff wall = a wall OWNED by a User (kind USER). Owner/author are polymorphic
// (see social.prisma); authors are resolved via socialActor so a customer's post
// on a staff wall renders too.

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const wallUserId = Number(id);
    if (Number.isNaN(wallUserId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

    try {
        const rows = await prisma.wallPost.findMany({
            where:   { ownerKind: "USER", ownerId: wallUserId },
            select:  { id: true, body: true, createdAt: true, authorKind: true, authorId: true },
            orderBy: { createdAt: "desc" },
        });
        const actors = await resolveSocialActors(rows.map((r) => ({ kind: r.authorKind, id: r.authorId })));
        const posts = rows.map((r) => ({
            id: r.id, body: r.body, createdAt: r.createdAt,
            author: actors.get(socialKey(r.authorKind, r.authorId))!,
        }));
        return NextResponse.json(posts);
    } catch (e) {
        return handleApiError(e, "Failed to fetch wall");
    }
}

const postSchema = z.object({
    body: z.string().trim().min(1, "Message is required").max(1000, "Max 1000 characters"),
});

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user: caller, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const wallUserId = Number(id);
    if (Number.isNaN(wallUserId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

    const wallUser = await prisma.user.findUnique({ where: { id: wallUserId }, select: { id: true } });
    if (!wallUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { data, error } = await validateRequest(req, postSchema);
    if (error) return error;

    try {
        const row = await prisma.wallPost.create({
            data:   { ownerKind: "USER", ownerId: wallUserId, authorKind: "USER", authorId: caller.id, body: data.body },
            select: { id: true, body: true, createdAt: true, authorKind: true, authorId: true },
        });
        const author = await resolveSocialActor({ kind: row.authorKind, id: row.authorId });
        return NextResponse.json({ id: row.id, body: row.body, createdAt: row.createdAt, author }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create post");
    }
}
