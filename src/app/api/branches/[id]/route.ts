import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const updateSchema = z.object({
    id:       z.string().trim().min(1).regex(/^[A-Z0-9-]+$/, "ID must be uppercase letters, numbers and hyphens only").optional(),
    name:     z.string().trim().min(1).optional(),
    address:  z.string().trim().optional().nullable(),
    phone:    z.string().trim().optional().nullable(),
    isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;
        const branch = await prisma.branch.update({ where: { id }, data: data });
        return NextResponse.json(branch);
    } catch (e) {
        return handleApiError(e, "Failed to update branch");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    try {
        const { id } = await params;
        const branch = await prisma.branch.findUnique({
            where: { id },
            include: { _count: { select: { positions: true, departments: true } } },
        });
        if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
        if (branch._count.positions > 0 || branch._count.departments > 0) {
            return NextResponse.json({ error: "Cannot delete branch with assigned positions or departments. Reassign first." }, { status: 400 });
        }
        await prisma.branch.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete branch");
    }
}
