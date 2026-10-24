import { prisma } from "@/shared/lib/prisma/prismaClient";
import { shopSlugClash } from "@/shared/lib/shop/shopSlug";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { invProductCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { normalizeProductCodes } from "@/shared/lib/inventory";
import { findSkuCodeCollision, skuCodeCollisionMessage } from "@/shared/lib/inventory/codeCollision";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    productOpeningValue, syncProductCacheFromOpening,
} from "@/modules/inventory/lib/stockValue";
import { resolveActiveBranchId } from "@/shared/lib/auth/activeBranch";
import {
    loadProductPage, loadProductSelection, parseProductListQuery, productInclude,
} from "@/modules/inventory/lib/productList";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";

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
    const { response } = await requireAuth();
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

        // One page, searched / filtered / sorted over ALL products on the
        // server (productList.ts). `idsOnly=1` is the edit grid's "select all
        // filtered": every match, as the small row bulk-apply needs.
        const query = parseProductListQuery(searchParams, activeBranchId);
        if (searchParams.get("idsOnly") === "1") {
            return NextResponse.json({ rows: await loadProductSelection(query) });
        }
        return NextResponse.json(await loadProductPage(query));
    } catch (e) {
        return handleApiError(e, "Failed to fetch products");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.PRODUCTS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invProductCreateSchema);
        if (error) return error;
        const b = data;
        const sku = b.sku.trim().toUpperCase();
        const existing = await prisma.invProduct.findUnique({ where: { sku } });
        if (existing) return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
        // Keep the scannable space (SKUs ∪ code values) disjoint so a scan resolves
        // to exactly one product.
        const collision = await findSkuCodeCollision({ sku, codeValues: (b.codes ?? []).map((c) => c.value) });
        if (collision) return NextResponse.json({ error: skuCodeCollisionMessage(collision) }, { status: 409 });
        await assertProductFks({
            unitId: b.unitId,
            categoryId: b.categoryId ?? null,
            groupId: b.groupId ?? null,
            brandId: b.brandId ?? null,
            warrantyTermId: b.warrantyTermId ?? null,
            gstRateId: b.gstRateId ?? null,
        });
        if (b.slug) {
            const clash = await shopSlugClash(b.slug, { kind: "product" });
            if (clash) return NextResponse.json({ error: clash }, { status: 409 });
        }
        const row = await prisma.invProduct.create({
            data: {
                sku,
                name: b.name,
                namePart: b.namePart ?? null,
                unitId: b.unitId,
                categoryId: b.categoryId ?? null,
                groupId: b.groupId ?? null,
                brandId: b.brandId ?? null,
                warrantyTermId: b.warrantyTermId ?? null,
                modelNo: b.modelNo ?? null,
                ...(b.codes && b.codes.length > 0
                    ? { codes: { create: normalizeProductCodes(b.codes).map((c, i) => ({ kind: c.kind, value: c.value, sortOrder: i })) } }
                    : {}),
                notes: b.notes ?? null,
                requireSaleNote: b.requireSaleNote ?? false,
                isActive: b.isActive ?? true,
                shopSubheading: b.shopSubheading ?? null,
                slug: b.slug ?? null,
                attrsJson: b.attrsJson ?? Prisma.DbNull,
                effectiveSalePricePaise: b.effectiveSalePricePaise ?? null,
                savedSalePricePaise: b.savedSalePricePaise ?? null,
                mrpPaise:   b.mrpPaise   ?? null,
                // Books-beginning opening stock — server computes openingValue.
                openingStock:     b.openingStock ?? null,
                openingRate:      b.openingRate  ?? null,
                openingValue:     productOpeningValue(b),
                openingStockDate: null,
                // GST classification — all null by default (resolver cascades at read time).
                gstRateId:  b.gstRateId  ?? null,
                hsnCode:    b.hsnCode    ?? null,
                taxability: b.taxability ?? null,
                // Sync the running qty cache from opening qty so list views
                // light up immediately. PR 3 dropped the costPaise cache —
                // cost now derives from the ledger walk (opening rate is the
                // synthetic first lot).
                ...syncProductCacheFromOpening(b),
            },
            include: productInclude,
        });
        // Materialize effectiveSalePricePaise so the new product is sellable in
        // POS immediately (mirrors voucher posters). Fire-and-forget — a recompute
        // failure must never fail the create.
        await recomputePricesForProducts([row.id]).catch((err: unknown) => {
            Sentry.captureException(err, { tags: { source: "price-recompute", productId: String(row.id) } });
            console.error("[price-recompute] failed for new product", row.id, err);
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        // Global-unique clash on InvProductCode.value (a barcode/EAN/UPC already
        // used by another product) — sku clashes are caught above.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            return NextResponse.json({ error: "A product code (barcode / EAN / UPC) is already in use." }, { status: 409 });
        }
        const msg = e instanceof Error ? e.message : "";
        if (msg === "Unit not found" || msg.endsWith("not found")) {
            return NextResponse.json({ error: msg }, { status: 400 });
        }
        return handleApiError(e, "Failed to create product");
    }
}
