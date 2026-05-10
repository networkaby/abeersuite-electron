import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invCategoryUpdateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { validateRequest } from "@/shared/lib/api";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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
            data: {
                ...(b.name !== undefined ? { name: b.name } : {}),
                ...(b.slug !== undefined ? { slug: b.slug } : {}),
                ...(b.parentId !== undefined ? { parentId: b.parentId } : {}),
                ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
            },
        });
        return NextResponse.json(row);
    } catch {
        return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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
    } catch {
        return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
    }
}
