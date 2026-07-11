import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invUnitUpdateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { revalidateTag } from "next/cache";
import { INV_UNITS_TAG } from "../route";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { parseIdParam } from "@/shared/lib/api";
import { pickDefined } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_EDIT);
    if (response) return response;
    try {
        const { id, error: idError } = await parseIdParam(params);
        if (idError) return idError;
        const { data, error } = await validateRequest(req, invUnitUpdateSchema);
        if (error) return error;
        const b = data;
        if (b.code !== undefined) {
            const code = b.code.toUpperCase();
            const clash = await prisma.invUnit.findFirst({ where: { code, NOT: { id } } });
            if (clash) return NextResponse.json({ error: "Unit code already exists" }, { status: 409 });
        }
        const row = await prisma.invUnit.update({
            where: { id },
            data: pickDefined({
                code: b.code?.toUpperCase(),
                label: b.label,
                decimals: b.decimals,
                isActive: b.isActive,
            }),
        });
        revalidateTag(INV_UNITS_TAG, { expire: 0 });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update unit");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_DELETE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const n = await prisma.invProduct.count({ where: { unitId: id } });
        if (n > 0) {
            return NextResponse.json({ error: "Cannot delete unit while products reference it." }, { status: 400 });
        }
        await prisma.invUnit.delete({ where: { id } });
        revalidateTag(INV_UNITS_TAG, { expire: 0 });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete unit");
    }
}
