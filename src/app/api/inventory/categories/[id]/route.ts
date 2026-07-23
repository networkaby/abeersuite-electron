import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invCategoryUpdateSchema } from "@/shared/lib/schemas/inventorySchemas";
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
        const { data, error } = await validateRequest(req, invCategoryUpdateSchema);
        if (error) return error;
        const b = data;
        if (b.parentId !== undefined && b.parentId !== null) {
            if (b.parentId === id) return NextResponse.json({ error: "Category cannot be its own parent" }, { status: 400 });
            const p = await prisma.invCategory.findUnique({ where: { id: b.parentId } });
            if (!p) return NextResponse.json({ error: "Parent category not found" }, { status: 400 });
        }
        if (b.slug !== undefined && b.slug !== null) {
            const clash = await prisma.invCategory.findFirst({ where: { slug: b.slug, NOT: { id } } });
            if (clash) return NextResponse.json({ error: "Slug already in use" }, { status: 409 });
        }
        const row = await prisma.invCategory.update({
            where: { id },
            data: pickDefined({
                name: b.name,
                slug: b.slug,
                parentId: b.parentId,
                isActive: b.isActive,
                // Movement-band overrides (null = inherit up the chain).
                slowAfterDays: b.slowAfterDays,
                nonMovingAfterDays: b.nonMovingAfterDays,
                deadAfterDays: b.deadAfterDays,
            }),
        });
        // A renamed category changes the generated name of products using it
        // (directly, or via the group/brand fallback chain resolving to it).
        if (b.name !== undefined) await regenerateProductNamesSafe({ categoryId: id });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update category");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_DELETE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        const childCount = await prisma.invCategory.count({ where: { parentId: id } });
        if (childCount > 0) {
            return NextResponse.json({ error: "Cannot delete category with child categories." }, { status: 400 });
        }
        const prodCount = await prisma.invProduct.count({ where: { categoryId: id } });
        if (prodCount > 0) {
            return NextResponse.json({ error: "Cannot delete category while products reference it." }, { status: 400 });
        }
        await prisma.invCategory.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete category");
    }
}
