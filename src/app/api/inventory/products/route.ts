import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { invProductCreateSchema } from "@/lib/inventory/schemas";

const productInclude = {
    unit: { select: { id: true, code: true, label: true } },
    category: { select: { id: true, name: true } },
    group: { select: { id: true, name: true } },
    brand: { select: { id: true, name: true } },
    warrantyTerm: { select: { id: true, name: true } },
} as const;

async function assertProductFks(data: {
    unitId: number;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
}) {
    const u = await prisma.invUnit.findUnique({ where: { id: data.unitId } });
    if (!u) throw new Error("Unit not found");
    if (data.categoryId != null) {
        const c = await prisma.invCategory.findUnique({ where: { id: data.categoryId } });
        if (!c) throw new Error("Category not found");
    }
    if (data.groupId != null) {
        const g = await prisma.invProductGroup.findUnique({ where: { id: data.groupId } });
        if (!g) throw new Error("Product group not found");
    }
    if (data.brandId != null) {
        const b = await prisma.invBrand.findUnique({ where: { id: data.brandId } });
        if (!b) throw new Error("Brand not found");
    }
    if (data.warrantyTermId != null) {
        const w = await prisma.invWarrantyTerm.findUnique({ where: { id: data.warrantyTermId } });
        if (!w) throw new Error("Warranty term not found");
    }
}

export async function GET() {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const rows = await prisma.invProduct.findMany({
            orderBy: { sku: "asc" },
            include: productInclude,
        });
        return NextResponse.json(rows);
    } catch {
        return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const parsed = invProductCreateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const b = parsed.data;
        const sku = b.sku.trim().toUpperCase();
        const existing = await prisma.invProduct.findUnique({ where: { sku } });
        if (existing) return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
        await assertProductFks({
            unitId: b.unitId,
            categoryId: b.categoryId ?? null,
            groupId: b.groupId ?? null,
            brandId: b.brandId ?? null,
            warrantyTermId: b.warrantyTermId ?? null,
        });
        const row = await prisma.invProduct.create({
            data: {
                sku,
                name: b.name,
                unitId: b.unitId,
                categoryId: b.categoryId ?? null,
                groupId: b.groupId ?? null,
                brandId: b.brandId ?? null,
                warrantyTermId: b.warrantyTermId ?? null,
                modelNo: b.modelNo ?? null,
                barcode1: b.barcode1 ?? null,
                barcode2: b.barcode2 ?? null,
                barcode3: b.barcode3 ?? null,
                ean1: b.ean1 ?? null,
                ean2: b.ean2 ?? null,
                ean3: b.ean3 ?? null,
                upc1: b.upc1 ?? null,
                upc2: b.upc2 ?? null,
                upc3: b.upc3 ?? null,
                notes: b.notes ?? null,
                isActive: b.isActive ?? true,
                // Default to tracked-at-zero so future Purchase increments
                // actually move the cache (NULL + n = NULL in Postgres).
                stock: 0,
            },
            include: productInclude,
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "Unit not found" || msg.endsWith("not found")) {
            return NextResponse.json({ error: msg }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
    }
}
