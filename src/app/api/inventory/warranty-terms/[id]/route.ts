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
import { checkWarrantyShape, isWarrantyType, warrantyPrintChanged } from "@/shared/lib/warranty/warrantyTerms";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_EDIT);
    if (response) return response;
    try {
        const { id, error: idError } = await parseIdParam(params);
        if (idError) return idError;
        const { data, error } = await validateRequest(req, invWarrantyTermUpdateSchema);
        if (error) return error;
        const b = data;
        const existing = await prisma.invWarrantyTerm.findUnique({
            where: { id },
            include: { _count: { select: { saleLines: true } } },
        });
        if (!existing) return NextResponse.json({ error: "Warranty term not found" }, { status: 404 });

        // The printed part, as it would be after this edit.
        const shape = checkWarrantyShape({
            warrantyType: b.warrantyType ?? (isWarrantyType(existing.warrantyType) ? existing.warrantyType : "SELLER"),
            durationDays: b.durationDays !== undefined ? b.durationDays ?? null : existing.durationDays,
            sellerDays:   b.sellerDays   !== undefined ? b.sellerDays ?? null   : existing.sellerDays,
        });
        if ("error" in shape) return NextResponse.json({ error: shape.error }, { status: 400 });
        const extraCondition = b.extraCondition !== undefined ? b.extraCondition?.trim() || null : existing.extraCondition;

        // A term on any bill is frozen: those bills reprint from it. Name,
        // description and active stay editable; a new policy = a new term.
        // Compared in the same clean shape, so an old row's 0 days vs null
        // never reads as an edit.
        const used = existing._count.saleLines;
        const was = checkWarrantyShape({
            warrantyType: isWarrantyType(existing.warrantyType) ? existing.warrantyType : "SELLER",
            durationDays: existing.durationDays,
            sellerDays:   existing.sellerDays,
        });
        const before = "value" in was ? { ...was.value, extraCondition: existing.extraCondition } : existing;
        if (used > 0 && warrantyPrintChanged(before, { ...shape.value, extraCondition })) {
            return NextResponse.json({
                error: `This term is on ${used} bill line${used === 1 ? "" : "s"}, so its type, days and extra condition are locked. Create a new term for the new policy.`,
            }, { status: 409 });
        }

        const row = await prisma.invWarrantyTerm.update({
            where: { id },
            data: {
                ...pickDefined({ name: b.name, description: b.description, isActive: b.isActive }),
                ...shape.value,
                extraCondition,
            },
        });
        // A renamed warranty term changes the generated name of products using it.
        if (b.name !== undefined) await regenerateProductNamesSafe({ warrantyTermId: id });
        return NextResponse.json({ ...row, usedOnBills: used });
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
        const [products, lines] = await Promise.all([
            prisma.invProduct.count({ where: { warrantyTermId: id } }),
            prisma.voucherInventoryLine.count({ where: { warrantyTermId: id } }),
        ]);
        if (products > 0) {
            return NextResponse.json({ error: "Cannot delete warranty term while products reference it." }, { status: 400 });
        }
        if (lines > 0) {
            return NextResponse.json({ error: "This term is on saved bills, so it cannot be deleted. Mark it inactive instead." }, { status: 400 });
        }
        await prisma.invWarrantyTerm.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete warranty term");
    }
}
