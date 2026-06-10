import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invBrandUpdateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { prismaUniqueError } from "@/shared/lib/api";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { parseIdParam } from "@/shared/lib/api";
import { pickDefined } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id, error: idError } = await parseIdParam(params);
        if (idError) return idError;
        const { data, error } = await validateRequest(req, invBrandUpdateSchema);
        if (error) return error;
        const b = data;
        const row = await prisma.invBrand.update({
            where: { id },
            data: pickDefined({
                name: b.name,
                isActive: b.isActive,
            }),
        });
        return NextResponse.json(row);
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "Brand name already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to update brand");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const n = await prisma.invProduct.count({ where: { brandId: id } });
        if (n > 0) {
            return NextResponse.json({ error: "Cannot delete brand while products reference it." }, { status: 400 });
        }
        await prisma.invBrand.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete brand");
    }
}
