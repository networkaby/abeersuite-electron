import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const updateSchema = z.object({
    title:            z.string().trim().min(1, "Title is required").optional(),
    branchId:         z.string().trim().optional().nullable(),
    departmentId:     z.string().trim().optional().nullable(),
    parentPositionId: z.string().trim().optional().nullable(),
    roleTemplateId:   z.string().trim().optional().nullable(),
});

const POSITION_INCLUDE = {
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
        const position = await prisma.position.findUnique({ where: { id }, include: POSITION_INCLUDE });
        if (!position) return NextResponse.json({ error: "Position not found" }, { status: 404 });
        return NextResponse.json(position);
    } catch (e) {
        return handleApiError(e, "Failed to fetch position");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;
        const position = await prisma.position.update({ where: { id }, data: data, include: POSITION_INCLUDE });
        return NextResponse.json(position);
    } catch (e) {
        return handleApiError(e, "Failed to update position");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    try {
        const { id } = await params;
        const position = await prisma.position.findUnique({
            where: { id },
            include: { _count: { select: { children: true, holders: true } } },
        });
        if (!position) return NextResponse.json({ error: "Position not found" }, { status: 404 });
        if (position._count.children > 0) {
            return NextResponse.json({ error: "Reassign or delete child positions first" }, { status: 400 });
        }
        if (position._count.holders > 0) {
            return NextResponse.json({ error: "Cannot delete position with assigned holders. Remove holders first." }, { status: 400 });
        }
        await prisma.position.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete position");
    }
}
