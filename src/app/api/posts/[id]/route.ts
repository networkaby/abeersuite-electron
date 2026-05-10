import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/authGuard";
import { z } from "zod";

const updateSchema = z.object({
    title:        z.string().trim().min(1, "Title is required").optional(),
    branchId:     z.string().trim().optional().nullable(),
    departmentId: z.string().trim().optional().nullable(),
    parentPostId: z.string().trim().optional().nullable(),
    roleTemplateId: z.string().trim().optional().nullable(),
});

const POST_INCLUDE = {
    branch:     { select: { id: true, name: true } },
    department: { select: { id: true, name: true } },
    parent:     { select: { id: true, title: true } },
    roleTemplate: { select: { id: true, label: true, color: true } },
    holders:    {
        select: {
            createdAt: true,
            user: { select: { id: true, name: true, avatarUrl: true, role: true, title: true, userRole: { select: { label: true, color: true } } } },
        },
    },
    _count: { select: { children: true } },
} as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const post = await prisma.post.findUnique({ where: { id }, include: POST_INCLUDE });
        if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
        return NextResponse.json(post);
    } catch {
        return NextResponse.json({ error: "Failed to fetch post" }, { status: 500 });
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = updateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const post = await prisma.post.update({ where: { id }, data: parsed.data, include: POST_INCLUDE });
        return NextResponse.json(post);
    } catch {
        return NextResponse.json({ error: "Failed to update post" }, { status: 500 });
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const post = await prisma.post.findUnique({
            where: { id },
            include: { _count: { select: { children: true, holders: true } } },
        });
        if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
        if (post._count.children > 0) {
            return NextResponse.json({ error: "Reassign or delete child posts first" }, { status: 400 });
        }
        await prisma.post.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete post" }, { status: 500 });
    }
}
