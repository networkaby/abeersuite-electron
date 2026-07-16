import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invWarrantyTermUpdateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { parseIdParam } from "@/shared/lib/api";
import { pickDefined } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { regenerateProductNamesSafe } from "@/modules/inventory/lib/regenerateNames";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_EDIT);
    if (response) return response;
    try {
        const { id, error: idError } = await parseIdParam(params);
        if (idError) return idError;
        const { data, error } = await validateRequest(req, invWarrantyTermUpdateSchema);
        if (error) return error;
        const b = data;
        const row = await prisma.invWarrantyTerm.update({
            where: { id },
            data: pickDefined({
                name: b.name,
                description: b.description,
                durationDays: b.durationDays,
                isActive: b.isActive,
            }),
        });
        // A renamed warranty term changes the generated name of products using it.
        if (b.name !== undefined) await regenerateProductNamesSafe({ warrantyTermId: id });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update warranty term");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_DELETE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
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
