import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { resolveCostBatch } from "@/modules/pricing-strategy/lib/resolveCost";
import { loadStrategyPoints, additiveMarginPct, additivePriceWithSurcharge } from "@/modules/pricing-strategy/lib/additiveMargin";
import { loadLastSaleAgeDays } from "@/modules/pricing-strategy/lib/matchStrategy";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { valueStockBatch } from "@/modules/inventory/lib/valuation";
import { getCurrentAdditionalCostByProduct } from "@/modules/pricing-strategy/lib/costPool";

export interface PricingItem {
    id:               number;
    sku:              string;
    name:             string;
    categoryId:       number | null;
    groupId:          number | null;
    brandId:          number | null;
    categoryName:     string | null;
    groupName:        string | null;
    brandName:        string | null;
    /** Current cached stock balance. null = stock not tracked (e.g. services). */
    stock:                number | null;
    /** Per-item cost method override. null = inherit from OrgDefaults.valuationMethod. */
    costMethod:           string | null;
    /** Resolved method actually used: product.costMethod ?? OrgDefaults.valuationMethod. */
    effectiveCostMethod:  string;
    /** Deprecated (PricingStrategy dropped) — always null. */
    strategyCostMethod:   string | null;
    marginPercent:    number | null;
    priceOverridden:  boolean;
    effectiveSalePricePaise: number | null;
    mrpPaise:         number | null;
    /** Stays in the interface as null for back-compat; STD_COST was dropped in PR 3. */
    stdCostPaise:     number | null;
    /** Last-inward rate (LAST_INWARD walk) for display only. PR 3 dropped the cache. */
    lastPurchasePaise: number | null;
    /** Cost resolved under the product's saved costMethod (null = no data). */
    resolvedCostPaise:    number | null;
    resolvedCostFallback: string | null;
    /** Per-unit additional cost (shipping/courier, GST-exclusive paise) from the
     *  Costing page allocation layer. Kept SEPARATE from resolvedCostPaise — the
     *  base cost stays pristine. 0 when nothing allocated. */
    additionalCostPaise:  number;
    /** Computed sell price (additive-margin engine) — already capped at MRP. */
    computedPricePaise:   number | null;
    /** Pre-cap value from the cost×margin formula. Same as computedPricePaise when no cap fired. */
    rawComputedPricePaise: number | null;
    /** True when MRP capped the formula. */
    cappedAtMrp:          boolean;
    /** Deprecated (PricingStrategy dropped) — always null. */
    strategyId:           number | null;
    /** Deprecated (PricingStrategy dropped) — always null. */
    strategyName:         string | null;
    /** The additive margin % applied (base + brand + category + group points). */
    appliedMarkupPct:     number;
    /** Deprecated (additive model has no flat add) — always 0. */
    appliedFlatPaise:     number;
    /** Deprecated (additive model has no rounding step) — always 0. */
    appliedRoundingPaise: number;
    /** Resolved GST rate % (0 when no tax set anywhere in the cascade). */
    gstRatePct:           number;
    /** Primary scannable barcode (InvProduct.barcode1). null = none set. */
    barcode:              string | null;
    /** Days since the last SALE/POS. null = never sold. Only populated with ?withSaleAge=1. */
    daysSinceLastSale:    number | null;
    /** Saved human sale price (paise). null = not set. Source of the barcode. */
    savedSalePricePaise:  number | null;
    /** Which source materializes the effective price: "STRATEGY" | "COMPUTED" | "SAVED". */
    effectiveSalePriceSource: string;
    /** ISO timestamp the sale price was last frozen, or null. */
    salePriceFrozenAt:    string | null;
    /** After-tax profit (paise) frozen at the last save, or null. */
    savedProfitPaise:     number | null;
}

export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const onlyAttention = searchParams.get("onlyAttention") === "1";
        // Opt-in: compute days-since-last-sale per product (one ledger groupBy).
        // Off by default so the items / needs-attention pages keep the cheap path.
        const withSaleAge = searchParams.get("withSaleAge") === "1";

        const [products, points, orgDefaults] = await Promise.all([
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
                    priceOverridden:  true,
                    barcode1:         true,
                    effectiveSalePriceSource: true,
                    savedSalePricePaise: true,
                    salePriceFrozenAt:   true,
                    savedProfitPaise:  true,
                    category: { select: { name: true } },
                    group:    { select: { name: true } },
                    brand:    { select: { name: true } },
                },
            }),
            loadStrategyPoints(),
            prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { valuationMethod: true } }),
        ]);
        const orgDefault = orgDefaults?.valuationMethod ?? "WEIGHTED_AVG";

        // Resolve GST rates for all products in 3 queries (cascade: product → group chain → org default).
        const taxResult = await resolveProductTaxBatch({});
        const taxByProduct = taxResult.products;

        // Days-since-last-sale — opt-in (one ledger groupBy) since only the
        // labels page needs it.
        const lastSaleAge = withSaleAge
            ? await loadLastSaleAgeDays(products.map((p) => p.id))
            : new Map<number, number | null>();

        // Pre-resolve LAST_INWARD for the display column. Replaces the dropped costPaise cache.
        const lastInwardCosts = await valueStockBatch(
            products.map((p) => ({ id: p.id, stock: p.stock })),
            "LAST_INWARD",
        );

        // Per-product additional cost (shipping/courier) from the Costing page.
        // Decision-support only — never sourced from the GL.
        const additionalCostByProduct = await getCurrentAdditionalCostByProduct(
            products.map((p) => p.id),
        );

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
        const costById = new Map<number, { paise: number | null; fallback: string | null }>();
        for (const [method, group] of byMethod.entries()) {
            const resolved = await resolveCostBatch(
                group.map((g) => ({ id: g.id, stock: g.stock })),
                method,
            );
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
                priceOverridden:   p.priceOverridden,
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
                barcode:               p.barcode1 ?? null,
                daysSinceLastSale:     lastSaleAge.get(p.id) ?? null,
                savedSalePricePaise:   p.savedSalePricePaise,
                effectiveSalePriceSource: p.effectiveSalePriceSource,
                salePriceFrozenAt:     p.salePriceFrozenAt ? p.salePriceFrozenAt.toISOString() : null,
                savedProfitPaise:      p.savedProfitPaise,
            };
        });

        if (onlyAttention) {
            items = items.filter(
                (i) =>
                    i.resolvedCostPaise == null ||
                    i.mrpPaise == null || i.mrpPaise <= 0 ||
                    i.effectiveSalePricePaise == null,
            );
        }

        return NextResponse.json(items);
    } catch (e) {
        return handleApiError(e, "Failed to load pricing items");
    }
}
