import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

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
    } catch (e) {
        return handleApiError(e, "Failed to fetch posts");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
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
    } catch (e) {
        return handleApiError(e, "Failed to create post");
    }
}
