import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { resolvePositionDepartmentId } from "@/shared/lib/org/positionDepartment";

const createSchema = z.object({
    id:               z.string().trim().min(1, "ID is required").toUpperCase(),
    title:            z.string().trim().min(1, "Title is required"),
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

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const positions = await prisma.position.findMany({
            orderBy: [{ branchId: "asc" }, { departmentId: "asc" }, { title: "asc" }],
            include: POSITION_INCLUDE,
        });
        return NextResponse.json(positions);
    } catch (e) {
        return handleApiError(e, "Failed to fetch positions");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { id, title, branchId, departmentId, parentPositionId, roleTemplateId } = data;
        const existing = await prisma.position.findUnique({ where: { id } });
        if (existing) return NextResponse.json({ error: "Position ID already exists" }, { status: 409 });
        // Department follows the role (a role carries its home department). A
        // manual departmentId is honoured only for a role-less seat.
        const resolvedDepartmentId = await resolvePositionDepartmentId(roleTemplateId, departmentId);
        const position = await prisma.position.create({
            data: {
                id,
                title,
                branchId: branchId ?? null,
                departmentId: resolvedDepartmentId,
                parentPositionId: parentPositionId ?? null,
                roleTemplateId: roleTemplateId ?? null,
            },
            include: POSITION_INCLUDE,
        });
        return NextResponse.json(position, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create position");
    }
}
