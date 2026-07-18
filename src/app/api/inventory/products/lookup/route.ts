import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { loadLastInwardCostMap } from "@/modules/inventory/lib/valuation";
import { resolveEffectiveCostMap } from "@/modules/pricing-strategy/lib/resolveCost";
import { buildRulesIndex, resolveRedeemCapPct } from "@/modules/loyalty/lib";
import { barcodeTagPaise, normalizeBarcodeBands } from "@/shared/lib/pricing/barcodePrice";
import { primaryBarcode } from "@/shared/lib/inventory";

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

/**
 * GET /api/inventory/products/lookup
 *
 * Two modes:
 *
 * 1. **List mode (default)** — returns every active product as a lightweight
 *    list for voucher / dialog pickers. Requires only authentication so any
 *    finance user can search products when entering vouchers.
 *
 * 2. **Single-code mode** — `?code=<sku|barcode|ean|upc>` returns at most one
 *    product whose `sku` or any `InvProductCode.value` matches the given code
 *    exactly. Used by the scan-to-add inputs on PhysicalStockPage
 *    and ManufacturingJournalPage. Returns `null` (200) when there's no
 *    match — callers branch on the response without needing an exception.
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
        const scanSelect = {
            id:                true,
            sku:               true,
            name:              true,
            stock:             true,
            reserved:          true,
            lowStockThreshold: true,
            effectiveSalePricePaise: true,
            mrpPaise:          true,
            savedSalePricePaise: true,
            requireSaleNote:   true,
            codes:        { select: { kind: true, value: true }, orderBy: { sortOrder: "asc" as const } },
            groupId:           true,
            categoryId:        true,
            unit:         { select: { code: true } },
            brand:        { select: { name: true } },
            warrantyTerm: { select: { name: true, durationDays: true } },
        };
        // Deterministic resolution: an exact SKU match wins, then fall back to a
        // scannable code. Both spaces are kept disjoint by the write-time guard
        // (see findSkuCodeCollision), so this only ever matters as belt-and-braces.
        // Each branch is a single indexed equality (replaces the old 9-column OR).
        const product =
            (await prisma.invProduct.findFirst({ where: { isActive: true, sku: code }, select: scanSelect }))
            ?? (await prisma.invProduct.findFirst({ where: { isActive: true, codes: { some: { value: code } } }, select: scanSelect }));
        if (!product) return NextResponse.json(null);
        const { products: taxByProduct } = await resolveProductTaxBatch({ productIds: [product.id] });
        const resolved = taxByProduct.get(product.id);
        const lastInward = await loadLastInwardCostMap([{ id: product.id, stock: product.stock }]);
        // GST-EXCLUSIVE effective cost — the spend-tier / %-coupon discount base.
        const costMap = await resolveEffectiveCostMap([product.id]);
        const capMap = await loadRedeemCapOverrides([{ id: product.id, groupId: product.groupId, categoryId: product.categoryId }]);
        return NextResponse.json({
            ...product,
            // Derived primary barcode for label/display consumers (replaces the
            // old stored barcode1 column). `codes` (spread above) is the full set.
            barcode1: primaryBarcode(product.codes),
            // The response already carries `effectiveSalePricePaise` (selected +
            // spread above) — POS reads that column name directly. We ALSO expose
            // it under the legacy `pricePaise` alias for the not-yet-renamed
            // Sale-voucher / lab / home / inventory pickers.
            pricePaise: product.effectiveSalePricePaise,
            taxRate: resolved?.gstRate ?? null,
            hsnCode: resolved?.hsnCode ?? null,
            lastPurchasePaise: lastInward.get(product.id) ?? null,
            // GST-EXCLUSIVE resolved cost (paise) — the spend-tier discount base.
            costPaise: costMap.get(product.id) ?? null,
            redeemCapPct: capMap.get(product.id) ?? null,
            // Printed barcode tag (paise) derived from saved price + MRP — the
            // public price snapshotted on POS lines for the customer ladder.
            barcodePricePaise: barcodeTagPaise(product.savedSalePricePaise, product.mrpPaise, barcodeBands),
            // O2C available-to-sell = on-hand − reserved (null when untracked).
            availableToSell: product.stock == null ? null : product.stock - (product.reserved ?? 0),
        });
    }

    const products = await prisma.invProduct.findMany({
        where:   { isActive: true },
        orderBy: { name: "asc" },
        select: {
            id:                true,
            sku:               true,
            name:              true,
            stock:             true,
            reserved:          true,
            lowStockThreshold: true,
            effectiveSalePricePaise: true,
            mrpPaise:          true,
            savedSalePricePaise: true,
            requireSaleNote:   true,
            codes:        { select: { kind: true, value: true }, orderBy: { sortOrder: "asc" } },
            groupId:           true,
            categoryId:        true,
            unit:         { select: { code: true } },
            brand:        { select: { name: true } },
            warrantyTerm: { select: { name: true, durationDays: true } },
        },
    });

    // Resolve effective GST + HSN per product via the cascade (product →
    // group chain → org defaults). Batch-resolved in 3 queries so this stays
    // cheap even with thousands of products. Snapshot consumers (POS cart,
    // voucher line entry) read taxRate/hsnCode to seed their per-line values.
    const { products: taxByProduct } = await resolveProductTaxBatch({
        productIds: products.map((p) => p.id),
    });

    // lastPurchasePaise — derived from the LAST_INWARD walk (PR 3 dropped the
    // costPaise cache). UI cost columns + manufacturing-journal rate seeds
    // read from here.
    const lastInward = await loadLastInwardCostMap(
        products.map((p) => ({ id: p.id, stock: p.stock })),
    );

    // GST-exclusive resolved cost per product (effective method) — the spend-tier /
    // %-coupon discount base snapshotted onto POS cart lines. Same order of work as
    // the lastInward walk above (batched per method).
    const costMap = await resolveEffectiveCostMap(products.map((p) => p.id));

    // Loyalty redeem-cap overrides (empty unless cap rules exist) so the POS can
    // size the redeemable amount per cart consistently with the server.
    const capMap = await loadRedeemCapOverrides(products.map((p) => ({ id: p.id, groupId: p.groupId, categoryId: p.categoryId })));

    const enriched = products.map((p) => {
        const r = taxByProduct.get(p.id);
        return {
            ...p,
            // Derived primary barcode for display consumers (full set is `codes`).
            barcode1: primaryBarcode(p.codes),
            // The response already carries `effectiveSalePricePaise` (selected +
            // spread above) — POS reads that column name directly. We ALSO expose
            // it under the legacy `pricePaise` alias for the not-yet-renamed
            // Sale-voucher / lab / home / inventory pickers.
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

    return NextResponse.json(enriched);
}
