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
import { requireWritableBranchId, resolveActiveBranchId } from "@/shared/lib/auth/activeBranch";
import { openingBranchOnSave, requireOpeningBranch } from "@/modules/inventory/lib/liveStock";
import {
    loadProductPage, loadProductSelection, parseProductListQuery, productInclude,
} from "@/modules/inventory/lib/productList";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";

/** Throws "<Master> not found" for the first referenced master that does not
 *  exist. All lookups run at once (id only) — one round trip, not six in a row;
 *  the first missing one in this order is the one reported, as before. */
async function assertProductFks(data: {
    unitId: number;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
    gstRateId: number | null;
}) {
    const id = { id: true } as const;
    const exists = (row: Promise<unknown>) => row.then(Boolean);
    const found = await Promise.all([
        exists(prisma.invUnit.findUnique({ where: { id: data.unitId }, select: id })),
        data.categoryId == null || exists(prisma.invCategory.findUnique({ where: { id: data.categoryId }, select: id })),
        data.groupId == null || exists(prisma.invProductGroup.findUnique({ where: { id: data.groupId }, select: id })),
        data.brandId == null || exists(prisma.invBrand.findUnique({ where: { id: data.brandId }, select: id })),
        data.warrantyTermId == null || exists(prisma.invWarrantyTerm.findUnique({ where: { id: data.warrantyTermId }, select: id })),
        data.gstRateId == null || exists(prisma.gstRate.findUnique({ where: { id: data.gstRateId }, select: id })),
    ]);
    const missing = found.indexOf(false);
    if (missing >= 0) {
        throw new Error(`${["Unit", "Category", "Product group", "Brand", "Warranty term", "GST rate"][missing]} not found`);
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
        // An opening quantity sits at the branch picked on the form, else the one
        // it is entered from. Resolved before any lookup so a bad pick, or "My
        // branches" mode, is refused at once.
        const session = await auth();
        const picked = b.openingStock != null && b.openingBranchId
            ? await requireOpeningBranch(session, b.openingBranchId)
            : null;
        const openingBranchId = openingBranchOnSave(
            b.openingStock, picked, () => requireWritableBranchId(req, session),
        );
        // Every pre-save check at once — one round trip instead of up to ten
        // in a row. The answers are then read in the old order, so the user
        // sees the same error first as before.
        const [existing, collision, fkError, clash] = await Promise.all([
            prisma.invProduct.findUnique({ where: { sku }, select: { id: true } }),
            // Keep the scannable space (SKUs ∪ code values) disjoint so a scan
            // resolves to exactly one product.
            findSkuCodeCollision({ sku, codeValues: (b.codes ?? []).map((c) => c.value) }),
            assertProductFks({
                unitId: b.unitId,
                categoryId: b.categoryId ?? null,
                groupId: b.groupId ?? null,
                brandId: b.brandId ?? null,
                warrantyTermId: b.warrantyTermId ?? null,
                gstRateId: b.gstRateId ?? null,
            }).then(() => null, (e: unknown) => e),
            b.slug ? shopSlugClash(b.slug, { kind: "product" }) : null,
        ]);
        if (existing) return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
        if (collision) return NextResponse.json({ error: skuCodeCollisionMessage(collision) }, { status: 409 });
        if (fkError) throw fkError;
        if (clash) return NextResponse.json({ error: clash }, { status: 409 });
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
                openingBranchId,
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
        // POS immediately (mirrors voucher posters). Awaited on purpose — that is
        // what makes it sellable at once — but a recompute failure must never
        // fail the create, so it is caught and reported.
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
