import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invBomUpdateSchema } from "@/shared/lib/schemas/bomSchemas";
import { handleApiError, validateRequest, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const row = await prisma.invBom.findUnique({
            where: { id },
            include: {
                outputProduct: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } },
                lines: { include: { product: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } } } },
            },
        });
        if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to fetch BOM");
    }
}

export async function PATCH(req: Request, { params }: Params) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id, error: idError } = await parseIdParam(params);
        if (idError) return idError;
        const { data, error } = await validateRequest(req, invBomUpdateSchema);
        if (error) return error;
        const b = data;
        // When `lines` is provided we wipe and recreate (simpler than diffing).
        const row = await prisma.$transaction(async (tx) => {
            if (b.lines) {
                await tx.invBomLine.deleteMany({ where: { bomId: id } });
            }
            return tx.invBom.update({
                where: { id },
                data: {
                    ...(b.name             !== undefined ? { name: b.name }                       : {}),
                    ...(b.outputProductId  !== undefined ? { outputProductId: b.outputProductId } : {}),
                    ...(b.outputQty        !== undefined ? { outputQty: b.outputQty }             : {}),
                    ...(b.description      !== undefined ? { description: b.description ?? null } : {}),
                    ...(b.isActive         !== undefined ? { isActive: b.isActive }               : {}),
                    ...(b.lines           ? {
                        lines: { create: b.lines.map((l) => ({ productId: l.productId, qty: l.qty })) },
                    } : {}),
                },
                include: {
                    outputProduct: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } },
                    lines: { include: { product: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } } } },
                },
            });
        });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update BOM");
    }
}

export async function DELETE(_req: Request, { params }: Params) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        // Refuse to delete BOMs that have been used on any voucher so the
        // audit trail (InvVoucher.bomId) doesn't dangle. Cancelled/draft
        // vouchers still count — operators can deactivate instead.
        const used = await prisma.invVoucher.count({ where: { bomId: id } });
        if (used > 0) {
            return NextResponse.json({ error: "Cannot delete a BOM that's been used on a voucher. Deactivate it instead." }, { status: 400 });
        }
        await prisma.invBom.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete BOM");
    }
}
