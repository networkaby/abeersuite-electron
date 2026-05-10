import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const updateSchema = z.object({
    name:        z.string().trim().min(1).optional(),
    description: z.string().trim().optional().nullable(),
    branchId:    z.string().trim().optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;
        const department = await prisma.department.update({
            where: { id },
            data: data,
            include: { branch: { select: { id: true, name: true } } },
        });
        return NextResponse.json(department);
    } catch (e) {
        return handleApiError(e, "Failed to update department");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    try {
        const { id } = await params;
        const dept = await prisma.department.findUnique({
            where: { id },
            include: { _count: { select: { users: true } } },
        });
        if (!dept) return NextResponse.json({ error: "Department not found" }, { status: 404 });
        if (dept._count.users > 0) {
            return NextResponse.json({ error: "Cannot delete department with assigned users. Reassign users first." }, { status: 400 });
        }
        await prisma.department.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete department");
    }
}
