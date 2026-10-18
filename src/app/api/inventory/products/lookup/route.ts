import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { loadLastInwardCostMap } from "@/modules/inventory/lib/valuation";
import { resolveEffectiveCostMap } from "@/modules/pricing-strategy/lib/resolveCost";
import { buildRulesIndex, resolveRedeemCapPct } from "@/modules/loyalty/lib";
import { barcodeTagPaise, normalizeBarcodeBands } from "@/shared/lib/pricing/barcodePrice";
import { primaryBarcode } from "@/shared/lib/inventory";
import { parseSince } from "@/shared/lib/prisma/counterMode";

/// Per-product loyalty redeem-cap OVERRIDE (% of the item's value redeemable with
/// points). Returns a Map<productId, number> holding only products an enabled
/// LoyaltyEarnRule caps (via product / group / category); products with no rule
/// are absent → POS falls back to the global cap. Returns an empty Map (and does
/// no extra queries beyond the rule probe) when no redeem-cap rules exist.
async function loadRedeemCapOverrides(products: { id: number; groupId: number | null; categoryId: number | null }[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    const rules = await prisma.loyaltyEarnRule.findMany({
        where: { enabled: true, redeemCapPct: { not: null } },
        select: { scope: true, categoryId: true, groupId: true, productId: true, multiplier: true, redeemCapPct: true, enabled: true },
    });
    if (rules.length === 0) return out;
    const [groups, categories] = await Promise.all([
        prisma.invProductGroup.findMany({ select: { id: true, parentId: true } }),
        prisma.invCategory.findMany({ select: { id: true, parentId: true } }),
    ]);
    const idx = buildRulesIndex(rules.map((r) => ({ ...r, multiplier: Number(r.multiplier), redeemCapPct: r.redeemCapPct == null ? null : Number(r.redeemCapPct) })));
    const maps = {
        groupParent: new Map(groups.map((g) => [g.id, g.parentId])),
        categoryParent: new Map(categories.map((c) => [c.id, c.parentId])),
    };
    for (const p of products) {
        const cap = resolveRedeemCapPct({ productId: p.id, groupId: p.groupId, categoryId: p.categoryId }, idx, maps, null);
        if (cap != null) out.set(p.id, cap);
    }
    return out;
}

/** Everything a picker needs off the product row itself. One definition so list,
 *  scan and sync modes cannot drift apart. */
const PRODUCT_SELECT = {
    id:                true,
    sku:               true,
    name:              true,
    // Sync mode needs this to tell a deactivated product from a live one; the
    // other modes already filter on it, so it is always true for them.
    isActive:          true,
    stock:             true,
    reserved:          true,
    lowStockThreshold: true,
    effectiveSalePricePaise: true,
    mrpPaise:          true,
    savedSalePricePaise: true,
    requireSaleNote:   true,
    imageUrl:          true,
    attrsJson:         true,
    codes:        { select: { kind: true, value: true }, orderBy: { sortOrder: "asc" as const } },
    groupId:           true,
    categoryId:        true,
    unit:         { select: { code: true } },
    brand:        { select: { name: true } },
    warrantyTerm: { select: { name: true, durationDays: true } },
    protection:   { select: { productId: true } },
} as const;

type ProductRow = Awaited<ReturnType<typeof loadProducts>>[number];
function loadProducts(where: Prisma.InvProductWhereInput) {
    return prisma.invProduct.findMany({ where, orderBy: { name: "asc" }, select: PRODUCT_SELECT });
}

/**
 * Attach everything that is NOT stored on the product row — resolved GST, costs,
 * loyalty caps, derived barcode tag.
 *
 * All four helpers are keyed by product id, so this is priced by how many rows
 * you pass, not by catalogue size. That is what makes delta sync worth having:
 * after a sale only the sold rows come through here, instead of every product.
 */
async function enrichProducts(products: ProductRow[], barcodeBands: ReturnType<typeof normalizeBarcodeBands>) {
    if (products.length === 0) return [];

    const ids = products.map((p) => p.id);
    const [{ products: taxByProduct }, lastInward, costMap, capMap] = await Promise.all([
        resolveProductTaxBatch({ productIds: ids }),
        loadLastInwardCostMap(products.map((p) => ({ id: p.id, stock: p.stock }))),
        resolveEffectiveCostMap(ids),
        loadRedeemCapOverrides(products.map((p) => ({ id: p.id, groupId: p.groupId, categoryId: p.categoryId }))),
    ]);

    return products.map((p) => {
        const r = taxByProduct.get(p.id);
        const { protection: _protection, ...pRest } = p;
        return {
            ...pRest,
            // Discount-protection blacklist flag (the raw `protection` relation
            // is stripped). POS snapshots it onto cart lines at add-to-cart.
            protected: _protection != null,
            // Derived primary barcode for display consumers (full set is `codes`).
            barcode1: primaryBarcode(p.codes),
            // The response already carries `effectiveSalePricePaise` (selected +
            // spread above) — POS reads that column name directly. We ALSO expose
            // it under the legacy `pricePaise` alias for the not-yet-renamed
            // Sale-voucher / home / inventory pickers.
            pricePaise: p.effectiveSalePricePaise,
            taxRate: r?.gstRate ?? null,
            hsnCode: r?.hsnCode ?? null,
            lastPurchasePaise: lastInward.get(p.id) ?? null,
            // GST-EXCLUSIVE resolved cost (paise) — the spend-tier discount base.
            costPaise: costMap.get(p.id) ?? null,
            redeemCapPct: capMap.get(p.id) ?? null,
            // Printed barcode tag (paise) derived from saved price + MRP — the
            // public price snapshotted on POS lines for the customer ladder.
            barcodePricePaise: barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, barcodeBands),
            // O2C available-to-sell = on-hand − reserved (null when untracked).
            availableToSell: p.stock == null ? null : p.stock - (p.reserved ?? 0),
        };
    });
}

/** Bump whenever PRODUCT_SELECT gains/loses a field — the browser's IndexedDB
 *  cache merges delta rows by id, so an already-cached row otherwise keeps its
 *  OLD shape (missing the new column) until it happens to get touched. This is
 *  the one part of the stamp that isn't a DB timestamp/count, so it's a manual
 *  version, not something to compute — bump it, don't try to make it clever. */
const SELECT_SHAPE_VERSION = "2"; // v2: + imageUrl, attrsJson

/**
 * Fingerprint of everything the enrichment depends on that does NOT live on a
 * product row — the tax cascade's group/category chain and org defaults, the
 * barcode bands, the loyalty redeem-cap rules. Edit any of those and no
 * product's `updatedAt` moves, so a timestamp delta alone would serve stale
 * tax or cap values; a changed stamp forces the client back to a full load.
 *
 * `GstRate` and `InvProductCode` have no `updatedAt`. Codes contribute a count —
 * a product's codes are only ever rewritten through the product itself, which
 * bumps its own `updatedAt`. Rates contribute count + id + rate sum, so a rate
 * edited in place also moves the stamp. The 15-day delta window is the
 * backstop for anything still missed.
 */
async function catalogueStamp(): Promise<string> {
    const [org, groups, categories, loyalty, codeCount, rates] = await Promise.all([
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { updatedAt: true } }),
        prisma.invProductGroup.aggregate({ _max: { updatedAt: true } }),
        prisma.invCategory.aggregate({ _max: { updatedAt: true } }),
        prisma.loyaltyEarnRule.aggregate({ _max: { updatedAt: true } }),
        prisma.invProductCode.count(),
        prisma.gstRate.aggregate({ _count: { _all: true }, _max: { id: true }, _sum: { rate: true } }),
    ]);
    const rateCount = `${rates._count._all}/${rates._max.id ?? "-"}/${rates._sum.rate?.toString() ?? "-"}`;
    return [
        SELECT_SHAPE_VERSION,
        org?.updatedAt?.toISOString() ?? "-",
        groups._max.updatedAt?.toISOString() ?? "-",
        categories._max.updatedAt?.toISOString() ?? "-",
        loyalty._max.updatedAt?.toISOString() ?? "-",
        codeCount,
        rateCount,
    ].join("|");
}

/** Past this, a delta is not worth it — just send the catalogue. */
const MAX_DELTA_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

/**
 * GET /api/inventory/products/lookup
 *
 * Three modes:
 *
 * 1. **List mode (default)** — returns every active product as a lightweight
 *    list for voucher / dialog pickers. Requires only authentication so any
 *    finance user can search products when entering vouchers. Returns a bare
 *    ARRAY; several pickers depend on that shape, so it must not change.
 *
 * 2. **Single-code mode** — `?code=<sku|barcode|ean|upc>` returns at most one
 *    product whose `sku` or any `InvProductCode.value` matches the given code
 *    exactly. Used by the scan-to-add inputs on PhysicalStockPage
 *    and ManufacturingJournalPage. Returns `null` (200) when there's no
 *    match — callers branch on the response without needing an exception.
 *
 * 3. **Sync mode** — `?sync=1[&since=<iso>&stamp=<s>]`, for the POS, which
 *    reopens its till several times a day and caches the catalogue in
 *    IndexedDB. Returns an ENVELOPE (never a bare array) so the client can tell
 *    a delta from a full load:
 *      { mode: "full",  products, computedAt, stamp, count }
 *      { mode: "delta", changed, removedIds, computedAt, stamp, count }
 *    A delta carries only rows touched since `since`; `count` lets the client
 *    prove it has not silently missed a hard delete, which no timestamp can
 *    show. Falls back to "full" when the stamp moved, the window is too old, or
 *    the client sent nothing to compare against.
 */
export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    const code = new URL(req.url).searchParams.get("code")?.trim();

    // Printed-barcode bands (OrgDefaults.barcodeBandsJson) — used to DERIVE the
    // tag price the customer sees on the shelf/receipt from each product's saved
    // sale price + MRP. Same function the "Update & Print Labels" page uses, so
    // shelf tag == receipt tag. Falls back to the seed defaults when unset.
    const orgDefaults = await prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { barcodeBandsJson: true } });
    const barcodeBands = normalizeBarcodeBands(orgDefaults?.barcodeBandsJson);

    if (code) {
        // Deterministic resolution: an exact SKU match wins, then fall back to a
        // scannable code. Both spaces are kept disjoint by the write-time guard
        // (see findSkuCodeCollision), so this only ever matters as belt-and-braces.
        // Each branch is a single indexed equality (replaces the old 9-column OR).
        const product =
            (await prisma.invProduct.findFirst({ where: { isActive: true, sku: code }, select: PRODUCT_SELECT }))
            ?? (await prisma.invProduct.findFirst({ where: { isActive: true, codes: { some: { value: code } } }, select: PRODUCT_SELECT }));
        if (!product) return NextResponse.json(null);
        const [enriched] = await enrichProducts([product], barcodeBands);
        return NextResponse.json(enriched);
    }

    const params = new URL(req.url).searchParams;

    // ── Sync mode (POS catalogue cache) ──────────────────────────────────────
    if (params.get("sync")) {
        // Captured BEFORE reading, so anything written mid-request still has an
        // `updatedAt` past it and is picked up by the next delta rather than lost.
        const now = new Date();
        const stamp = await catalogueStamp();
        const since = parseSince(params.get("since"));

        const canDelta =
            since != null
            && params.get("stamp") === stamp
            && now.getTime() - since.getTime() < MAX_DELTA_WINDOW_MS;

        if (canDelta) {
            // No `isActive` filter — a product that was just deactivated must come
            // back as a removal, and it can only be spotted by its bumped row.
            const touched = await loadProducts({ updatedAt: { gt: since! } });
            const [active, count] = await Promise.all([
                enrichProducts(touched.filter((p) => p.isActive), barcodeBands),
                prisma.invProduct.count({ where: { isActive: true } }),
            ]);
            return NextResponse.json({
                mode: "delta",
                changed: active,
                removedIds: touched.filter((p) => !p.isActive).map((p) => p.id),
                computedAt: now.toISOString(),
                stamp,
                count,
            });
        }

        const products = await loadProducts({ isActive: true });
        return NextResponse.json({
            mode: "full",
            products: await enrichProducts(products, barcodeBands),
            computedAt: now.toISOString(),
            stamp,
            count: products.length,
        });
    }

    // ── List mode — bare array, the shape every other picker expects ─────────
    return NextResponse.json(await enrichProducts(await loadProducts({ isActive: true }), barcodeBands));
}
