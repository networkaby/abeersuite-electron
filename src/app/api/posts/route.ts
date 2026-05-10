import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

const createSchema = z.object({
    id:           z.string().trim().min(1, "ID is required").toUpperCase(),
    title:        z.string().trim().min(1, "Title is required"),
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

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const posts = await prisma.post.findMany({
            orderBy: [{ branchId: "asc" }, { departmentId: "asc" }, { title: "asc" }],
            include: POST_INCLUDE,
        });
        return NextResponse.json(posts);
    } catch (error) {
        console.error("GET /api/posts failed", error);
        return NextResponse.json({ error: "Failed to fetch posts" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { id, title, branchId, departmentId, parentPostId, roleTemplateId } = data;
        const existing = await prisma.post.findUnique({ where: { id } });
        if (existing) return NextResponse.json({ error: "Post ID already exists" }, { status: 409 });
        const post = await prisma.post.create({
            data: {
                id,
                title,
                branchId: branchId ?? null,
                departmentId: departmentId ?? null,
                parentPostId: parentPostId ?? null,
                roleTemplateId: roleTemplateId ?? null,
            },
            include: POST_INCLUDE,
        });
        return NextResponse.json(post, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
    }
}
