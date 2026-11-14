import { barcodeTagPaise } from "@/shared/lib/pricing/barcodePrice";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { resolveCostBatch } from "@/modules/pricing-strategy/lib/resolveCost";
import { loadStrategyPoints, additiveMarginPct, additivePriceWithSurcharge } from "@/modules/pricing-strategy/lib/additiveMargin";
import { loadLastSaleAgeDays } from "@/modules/pricing-strategy/lib/matchStrategy";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { valueStockBatch } from "@/modules/inventory/lib/valuation";
import { getCurrentAdditionalCostByProduct } from "@/modules/pricing-strategy/lib/costPool";
import { primaryBarcode } from "@/shared/lib/inventory";

import type { PricingItem } from "@/modules/pricing-strategy/lib/pricingItem";

// Today's barcode gap as % of the gap when the barcode was saved. null when
// there is no barcode, no snapshot, or the original gap was not positive.
function barcodeGapPct(tag: number | null, base: number | null, effective: number | null): number | null {
    if (tag == null || base == null || effective == null) return null;
    const original = tag - base;
    if (original <= 0) return null;
    return Math.round(((tag - effective) / original) * 1000) / 10;
}

export async function GET(req: Request) {
    // Item list feeds Needs attention + Update & print labels — readable by any
    // pricing role (or the inventory:manage umbrella). Editing an item stays on
    // inventory:manage (see items/[id] PATCH).
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const onlyAttention = searchParams.get("onlyAttention") === "1";
        // Opt-in: compute days-since-last-sale per product (one ledger groupBy).
        // Off by default so the items / needs-attention pages keep the cheap path.
        const withSaleAge = searchParams.get("withSaleAge") === "1";
        // Needs Attention "Low barcode gap": flag when today's gap (barcode −
        // effective) is below this % of the gap at barcode-save time. Default 30.
        const gapPctParam = Number(searchParams.get("gapPct"));
        const gapPct = Number.isFinite(gapPctParam) && gapPctParam > 0 ? gapPctParam : 30;

        // Every step is a whole-catalogue read, so they run side by side: the
        // ones that need nothing first, then the ones that need the product ids.
        const [products, points, orgDefaults, bands, taxResult] = await Promise.all([
            prisma.invProduct.findMany({
                where:   { isActive: true },
                orderBy: [{ name: "asc" }],
                select:  {
                    id:               true,
                    sku:              true,
                    name:             true,
                    categoryId:       true,
                    groupId:          true,
                    brandId:          true,
                    stock:            true,
                    effectiveSalePricePaise: true,
                    mrpPaise:         true,
                    costMethod:       true,
                    marginPercent:    true,
                    codes:            { select: { kind: true, value: true }, orderBy: { sortOrder: "asc" } },
                    effectiveSalePriceSource: true,
                    savedSalePricePaise: true,
                    barcodeManualPaise: true,
                    barcodeIsManual:    true,
                    barcodeGapBasePaise: true,
                    salePriceFrozenAt:   true,
                    tempPriceSetAt:      true,
                    category: { select: { name: true } },
                    group:    { select: { name: true } },
                    brand:    { select: { name: true } },
                },
            }),
            loadStrategyPoints(),
            prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { valuationMethod: true } }),
            loadBarcodeBands(),
            // GST rates for all products in 3 queries (cascade: product → group chain → org default).
            resolveProductTaxBatch({}),
        ]);
        const orgDefault = orgDefaults?.valuationMethod ?? "WEIGHTED_AVG";

        const taxByProduct = taxResult.products;

        // Effective cost method per product: product.costMethod ?? OrgDefaults.valuationMethod.
        type EffectiveMethod = Exclude<typeof products[number]["costMethod"], null>;
        const effectiveMethodOf = (p: typeof products[number]): EffectiveMethod => p.costMethod ?? orgDefault;

        // Group products by effective cost method so we issue one batch per method.
        const byMethod = new Map<EffectiveMethod, typeof products>();
        for (const p of products) {
            const m = effectiveMethodOf(p);
            const arr = byMethod.get(m);
            if (arr) arr.push(p); else byMethod.set(m, [p]);
        }

        const ids = products.map((p) => p.id);
        const [lastSaleAge, lastInwardCosts, additionalCostByProduct, resolvedByMethod] = await Promise.all([
            // Days-since-last-sale — opt-in (one ledger groupBy) since only the
            // labels page needs it.
            withSaleAge ? loadLastSaleAgeDays(ids) : Promise.resolve(new Map<number, number | null>()),
            // Pre-resolve LAST_INWARD for the display column. Replaces the dropped costPaise cache.
            valueStockBatch(products.map((p) => ({ id: p.id, stock: p.stock })), "LAST_INWARD"),
            // Per-product additional cost (shipping/courier) from the Costing page.
            // Decision-support only — never sourced from the GL.
            getCurrentAdditionalCostByProduct(ids),
            // One cost batch per method.
            Promise.all([...byMethod.entries()].map(([method, group]) =>
                resolveCostBatch(group.map((g) => ({ id: g.id, stock: g.stock })), method))),
        ]);

        const costById = new Map<number, { paise: number | null; fallback: string | null }>();
        for (const resolved of resolvedByMethod) {
            for (const [id, r] of resolved) {
                costById.set(id, { paise: r.costPaise, fallback: r.fallback ?? null });
            }
        }

        let items: PricingItem[] = products.map((p) => {
            const cost  = costById.get(p.id) ?? { paise: null, fallback: null };
            const gstRatePct = taxByProduct.get(p.id)?.gstRate ?? 0;
            const mc = lastInwardCosts.get(p.id);
            const lastInwardPaise = mc && mc.unitCost > 0 ? Math.round(mc.unitCost * 100) : null;
            // STRATEGY voice = the additive-margin engine (markup on cost).
            // Additional cost (shipping) folds in BEFORE GST; base cost stays pristine.
            const margin = additiveMarginPct(p, points);
            const additionalCostPaise = additionalCostByProduct.get(p.id) ?? 0;
            const priced = additivePriceWithSurcharge(cost.paise, additionalCostPaise, margin, p.mrpPaise, gstRatePct);
            return {
                id:                p.id,
                sku:               p.sku,
                name:              p.name,
                categoryId:        p.categoryId,
                groupId:           p.groupId,
                brandId:           p.brandId,
                categoryName:      p.category?.name ?? null,
                groupName:         p.group?.name ?? null,
                brandName:         p.brand?.name ?? null,
                stock:                p.stock,
                costMethod:           p.costMethod,
                effectiveCostMethod:  effectiveMethodOf(p),
                strategyCostMethod:   null,
                marginPercent:     p.marginPercent != null ? Number(p.marginPercent) : null,
                effectiveSalePricePaise: p.effectiveSalePricePaise,
                mrpPaise:          p.mrpPaise,
                stdCostPaise:      null,
                lastPurchasePaise: lastInwardPaise,
                resolvedCostPaise:     cost.paise,
                resolvedCostFallback:  cost.fallback,
                additionalCostPaise,
                computedPricePaise:    priced.pricePaise,
                rawComputedPricePaise: priced.rawPricePaise,
                cappedAtMrp:           priced.cappedAtMrp,
                strategyId:            null,
                strategyName:          null,
                appliedMarkupPct:      margin,
                appliedFlatPaise:      0,
                appliedRoundingPaise:  0,
                gstRatePct,
                barcode:               primaryBarcode(p.codes),
                codes:                 p.codes,
                daysSinceLastSale:     lastSaleAge.get(p.id) ?? null,
                savedSalePricePaise:   p.savedSalePricePaise,
                barcodeManualPaise:    p.barcodeManualPaise,
                barcodeIsManual:       p.barcodeIsManual,
                barcodeGapPct:         barcodeGapPct(
                    barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands, p.barcodeManualPaise),
                    p.barcodeGapBasePaise,
                    p.effectiveSalePricePaise,
                ),
                effectiveSalePriceSource: p.effectiveSalePriceSource,
                salePriceFrozenAt:     p.salePriceFrozenAt ? p.salePriceFrozenAt.toISOString() : null,
                tempPriceSetAt:        p.tempPriceSetAt ? p.tempPriceSetAt.toISOString() : null,
            };
        });

        if (onlyAttention) {
            items = items.filter(
                (i) =>
                    i.resolvedCostPaise == null ||
                    i.mrpPaise == null || i.mrpPaise <= 0 ||
                    i.effectiveSalePricePaise == null ||
                    (i.barcodeGapPct != null && i.barcodeGapPct < gapPct),
            );
        }

        return NextResponse.json(items);
    } catch (e) {
        return handleApiError(e, "Failed to load pricing items");
    }
}
