import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invProductUpdateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { validateRequest } from "@/shared/lib/api";
import {
    productOpeningValue, syncProductCacheFromOpening,
} from "@/modules/inventory/lib/stockValue";

const productInclude = {
    unit: { select: { id: true, code: true, label: true } },
    category: { select: { id: true, name: true } },
    group: { select: { id: true, name: true } },
    brand: { select: { id: true, name: true } },
    warrantyTerm: { select: { id: true, name: true } },
} as const;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const row = await prisma.invProduct.findUnique({
            where: { id },
            include: productInclude,
        });
        if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(row);
    } catch {
        return NextResponse.json({ error: "Failed to fetch product" }, { status: 500 });
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const { data, error } = await validateRequest(req, invProductUpdateSchema);
        if (error) return error;
        const b = data;
        const current = await prisma.invProduct.findUnique({ where: { id } });
        if (!current) return NextResponse.json({ error: "Product not found" }, { status: 404 });

        const unitId = b.unitId ?? current.unitId;
        const categoryId = b.categoryId !== undefined ? b.categoryId : current.categoryId;
        const groupId = b.groupId !== undefined ? b.groupId : current.groupId;
        const brandId = b.brandId !== undefined ? b.brandId : current.brandId;
        const warrantyTermId = b.warrantyTermId !== undefined ? b.warrantyTermId : current.warrantyTermId;

        const u = await prisma.invUnit.findUnique({ where: { id: unitId } });
        if (!u) return NextResponse.json({ error: "Unit not found" }, { status: 400 });
        if (categoryId != null) {
            const c = await prisma.invCategory.findUnique({ where: { id: categoryId } });
            if (!c) return NextResponse.json({ error: "Category not found" }, { status: 400 });
        }
        if (groupId != null) {
            const g = await prisma.invProductGroup.findUnique({ where: { id: groupId } });
            if (!g) return NextResponse.json({ error: "Product group not found" }, { status: 400 });
        }
        if (brandId != null) {
            const br = await prisma.invBrand.findUnique({ where: { id: brandId } });
            if (!br) return NextResponse.json({ error: "Brand not found" }, { status: 400 });
        }
        if (warrantyTermId != null) {
            const w = await prisma.invWarrantyTerm.findUnique({ where: { id: warrantyTermId } });
            if (!w) return NextResponse.json({ error: "Warranty term not found" }, { status: 400 });
        }

        let sku = current.sku;
        if (b.sku !== undefined) {
            sku = b.sku.trim().toUpperCase();
            if (sku !== current.sku) {
                const clash = await prisma.invProduct.findFirst({ where: { sku, NOT: { id } } });
                if (clash) return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
            }
        }

        const row = await prisma.invProduct.update({
            where: { id },
            data: {
                ...(b.sku !== undefined ? { sku } : {}),
                ...(b.name !== undefined ? { name: b.name } : {}),
                ...(b.unitId !== undefined ? { unitId: b.unitId } : {}),
                ...(b.categoryId !== undefined ? { categoryId: b.categoryId } : {}),
                ...(b.groupId !== undefined ? { groupId: b.groupId } : {}),
                ...(b.brandId !== undefined ? { brandId: b.brandId } : {}),
                ...(b.warrantyTermId !== undefined ? { warrantyTermId: b.warrantyTermId } : {}),
                ...(b.modelNo !== undefined ? { modelNo: b.modelNo } : {}),
                ...(b.barcode1 !== undefined ? { barcode1: b.barcode1 } : {}),
                ...(b.barcode2 !== undefined ? { barcode2: b.barcode2 } : {}),
                ...(b.barcode3 !== undefined ? { barcode3: b.barcode3 } : {}),
                ...(b.ean1 !== undefined ? { ean1: b.ean1 } : {}),
                ...(b.ean2 !== undefined ? { ean2: b.ean2 } : {}),
                ...(b.ean3 !== undefined ? { ean3: b.ean3 } : {}),
                ...(b.upc1 !== undefined ? { upc1: b.upc1 } : {}),
                ...(b.upc2 !== undefined ? { upc2: b.upc2 } : {}),
                ...(b.upc3 !== undefined ? { upc3: b.upc3 } : {}),
                ...(b.notes !== undefined ? { notes: b.notes } : {}),
                ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
                ...(b.pricePaise !== undefined ? { pricePaise: b.pricePaise } : {}),
                ...(b.mrpPaise   !== undefined ? { mrpPaise:   b.mrpPaise   } : {}),
                // Opening fields are written together so openingValue stays consistent.
                ...((b.openingStock !== undefined || b.openingRate !== undefined) ? {
                    openingStock: b.openingStock ?? null,
                    openingRate:  b.openingRate  ?? null,
                    openingValue: productOpeningValue(b),
                    // Sync running caches via shared helper. Explicit
                    // costPaise (Pricing tab) wins over opening-derived cost.
                    ...syncProductCacheFromOpening(b),
                } : {}),
                ...(b.openingStockDate !== undefined ? {
                    openingStockDate: b.openingStockDate ? new Date(b.openingStockDate) : null,
                } : {}),
                ...(b.costPaise !== undefined ? { costPaise: b.costPaise } : {}),
            },
            include: productInclude,
        });
        return NextResponse.json(row);
    } catch {
        return NextResponse.json({ error: "Failed to update product" }, { status: 500 });
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const orderLineCount = await prisma.shopOrderLine.count({ where: { productId: id } });
        if (orderLineCount > 0) return NextResponse.json({ error: "Cannot delete — referenced in shop orders." }, { status: 400 });
        await prisma.invProduct.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
    }
}
