import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invWarrantyTermUpdateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const { data, error } = await validateRequest(req, invWarrantyTermUpdateSchema);
        if (error) return error;
        const b = data;
        const row = await prisma.invWarrantyTerm.update({
            where: { id },
            data: {
                ...(b.name !== undefined ? { name: b.name } : {}),
                ...(b.description !== undefined ? { description: b.description } : {}),
                ...(b.durationDays !== undefined ? { durationDays: b.durationDays } : {}),
                ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
            },
        });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update warranty term");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const n = await prisma.invProduct.count({ where: { warrantyTermId: id } });
        if (n > 0) {
            return NextResponse.json({ error: "Cannot delete warranty term while products reference it." }, { status: 400 });
        }
        await prisma.invWarrantyTerm.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete warranty term");
    }
}
