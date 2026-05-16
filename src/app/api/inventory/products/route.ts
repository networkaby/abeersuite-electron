import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invProductCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    productOpeningValue, syncProductCacheFromOpening,
} from "@/modules/inventory/lib/stockValue";
import { resolveActiveBranchId } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";

const productInclude = {
    unit: { select: { id: true, code: true, label: true } },
    category: { select: { id: true, name: true } },
    group: { select: { id: true, name: true } },
    brand: { select: { id: true, name: true } },
    warrantyTerm: { select: { id: true, name: true } },
    gstRate: { select: { id: true, rate: true, label: true } },
} as const;

async function assertProductFks(data: {
    unitId: number;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
    gstRateId: number | null;
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
    if (data.gstRateId != null) {
        const gr = await prisma.gstRate.findUnique({ where: { id: data.gstRateId } });
        if (!gr) throw new Error("GST rate not found");
    }
}

export async function GET(req: NextRequest) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const session = await auth();
        const { searchParams } = new URL(req.url);
        const branchParam = searchParams.get("branchId");

        let activeBranchId: string | null = null;
        if (branchParam === "all") {
            activeBranchId = null; // org-wide view
        } else if (branchParam) {
            activeBranchId = branchParam;
        } else {
            try { activeBranchId = resolveActiveBranchId(req, session); }
            catch { activeBranchId = null; }
        }

        const rows = await prisma.invProduct.findMany({
            orderBy: { sku: "asc" },
            include: {
                ...productInclude,
                branchStocks: activeBranchId
                    ? { where: { branchId: activeBranchId }, select: { branchId: true, stock: true } }
                    : { select: { branchId: true, stock: true } },
            },
        });

        // Surface per-branch stock as `stock` (overrides legacy global cache)
        // when a single branch is in scope; otherwise return the sum.
        const enriched = rows.map((r) => {
            const branchStocks = (r as { branchStocks?: { stock: number }[] }).branchStocks ?? [];
            const branchStock = activeBranchId
                ? (branchStocks[0]?.stock ?? 0)
                : branchStocks.reduce((s, b) => s + b.stock, 0);
            return { ...r, stock: branchStock };
        });

        return NextResponse.json(enriched);
    } catch (e) {
        return handleApiError(e, "Failed to fetch products");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invProductCreateSchema);
        if (error) return error;
        const b = data;
        const sku = b.sku.trim().toUpperCase();
        const existing = await prisma.invProduct.findUnique({ where: { sku } });
        if (existing) return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
        await assertProductFks({
            unitId: b.unitId,
            categoryId: b.categoryId ?? null,
            groupId: b.groupId ?? null,
            brandId: b.brandId ?? null,
            warrantyTermId: b.warrantyTermId ?? null,
            gstRateId: b.gstRateId ?? null,
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
                shopSubheading: b.shopSubheading ?? null,
                slug: b.slug ?? null,
                attrsJson: b.attrsJson ?? Prisma.DbNull,
                pricePaise: b.pricePaise ?? null,
                mrpPaise:   b.mrpPaise   ?? null,
                // Books-beginning opening stock — server computes openingValue.
                openingStock:     b.openingStock ?? null,
                openingRate:      b.openingRate  ?? null,
                openingValue:     productOpeningValue(b),
                openingStockDate: b.openingStockDate ? new Date(b.openingStockDate) : null,
                // GST classification — all null by default (resolver cascades at read time).
                gstRateId:  b.gstRateId  ?? null,
                hsnCode:    b.hsnCode    ?? null,
                taxability: b.taxability ?? null,
                // Sync running caches via shared helper so reports light up
                // immediately. Explicit costPaise (Pricing tab) wins over the
                // helper's opening-derived costPaise — see merge below.
                ...syncProductCacheFromOpening(b),
                ...(b.costPaise != null ? { costPaise: b.costPaise } : {}),
            },
            include: productInclude,
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "Unit not found" || msg.endsWith("not found")) {
            return NextResponse.json({ error: msg }, { status: 400 });
        }
        return handleApiError(e, "Failed to create product");
    }
}
