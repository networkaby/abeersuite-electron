import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const POST_SELECT = {
    id:        true,
    body:      true,
    createdAt: true,
    author: {
        select: {
            id: true, name: true, avatarUrl: true, role: true,
            userRole: { select: { label: true, color: true } },
        },
    },
} as const;

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
        const posts = await prisma.wallPost.findMany({
            where:   { wallUserId },
            select:  POST_SELECT,
            orderBy: { createdAt: "desc" },
        });
        return NextResponse.json(posts);
    } catch {
        return NextResponse.json({ error: "Failed to fetch wall" }, { status: 500 });
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

    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

    try {
        const post = await prisma.wallPost.create({
            data:   { wallUserId, authorId: caller.id, body: parsed.data.body },
            select: POST_SELECT,
        });
        return NextResponse.json(post, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
    }
}
