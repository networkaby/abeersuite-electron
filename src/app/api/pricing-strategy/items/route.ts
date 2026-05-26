import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { resolveCostBatch } from "@/modules/pricing-strategy/lib/resolveCost";
import { applyStrategy } from "@/modules/pricing-strategy/lib/resolvePrice";
import { pickStrategy, buildMatchContext } from "@/modules/pricing-strategy/lib/matchStrategy";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";

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
    /** Per-item cost method override. null = inherit from strategy. */
    costMethod:           string | null;
    /** Resolved method actually used: product.costMethod ?? strategy.costMethod ?? WEIGHTED_AVG_COST. */
    effectiveCostMethod:  string;
    /** Strategy's default cost method, surfaced for the UI to show "from strategy" hints. */
    strategyCostMethod:   string | null;
    marginPercent:    number | null;
    priceOverridden:  boolean;
    pricePaise:       number | null;
    mrpPaise:         number | null;
    stdCostPaise:     number | null;
    lastPurchasePaise: number | null;
    /** Cost resolved under the product's saved costMethod (null = no data). */
    resolvedCostPaise:    number | null;
    resolvedCostFallback: string | null;
    /** Computed sell price under the matching strategy — already capped at MRP. */
    computedPricePaise:   number | null;
    /** Pre-cap value from the cost+margin formula. Same as computedPricePaise when no cap fired. */
    rawComputedPricePaise: number | null;
    /** True when MRP capped the formula. */
    cappedAtMrp:          boolean;
    /** Which strategy matched, or null if none active. */
    strategyId:           number | null;
    strategyName:         string | null;
    appliedMarkupPct:     number;
    /** Strategy's flat add (paise) — exposed so the client can replay the formula live. */
    appliedFlatPaise:     number;
    /** Strategy's rounding step (paise) — same. */
    appliedRoundingPaise: number;
    /** Resolved GST rate % (0 when no tax set anywhere in the cascade). */
    gstRatePct:           number;
}

export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const onlyAttention = searchParams.get("onlyAttention") === "1";

        const [products, strategies] = await Promise.all([
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
                    costPaise:        true,
                    pricePaise:       true,
                    mrpPaise:         true,
                    costMethod:       true,
                    marginPercent:    true,
                    priceOverridden:  true,
                    stdCostPaise:     true,
                    attrsJson:        true,
                    category: { select: { name: true } },
                    group:    { select: { name: true } },
                    brand:    { select: { name: true } },
                },
            }),
            prisma.pricingStrategy.findMany({ where: { isActive: true } }),
        ]);

        // Resolve GST rates for all products in 3 queries (cascade: product → group chain → org default).
        const taxResult = await resolveProductTaxBatch({});
        const taxByProduct = taxResult.products;

        // Build match context — only query lastSaleAgeDays when at least one
        // active strategy uses staleAfterDays, to skip the ledger groupBy in
        // the common case.
        const needsStaleness = strategies.some((s) => s.staleAfterDays != null);
        const matchCtx = await buildMatchContext({
            productIdsForStaleness: needsStaleness ? products.map((p) => p.id) : [],
        });

        // Effective cost method per product: product.costMethod ?? matched
        // strategy's costMethod ?? hard fallback. Precompute so we can both
        // group-batch the resolver and surface the source on the response.
        type EffectiveMethod = Exclude<typeof products[number]["costMethod"], null>;
        type Match = { effectiveMethod: EffectiveMethod; strategyId: number | null; strategyName: string | null };
        const matches = new Map<number, Match>();
        for (const p of products) {
            const matched = pickStrategy(
                {
                    id:         p.id,
                    brandId:    p.brandId,
                    groupId:    p.groupId,
                    categoryId: p.categoryId,
                    costPaise:  p.costPaise,
                    stock:      p.stock,
                    attrsJson:  (p.attrsJson ?? null) as Record<string, unknown> | null,
                },
                strategies,
                matchCtx,
            );
            const effective: EffectiveMethod =
                p.costMethod ?? matched?.costMethod ?? "WEIGHTED_AVG_COST";
            matches.set(p.id, {
                effectiveMethod: effective,
                strategyId:      matched?.id ?? null,
                strategyName:    matched?.name ?? null,
            });
        }

        // Group products by effective cost method so we issue one batch per method.
        const byMethod = new Map<EffectiveMethod, typeof products>();
        for (const p of products) {
            const m = matches.get(p.id)!.effectiveMethod;
            const arr = byMethod.get(m);
            if (arr) arr.push(p); else byMethod.set(m, [p]);
        }
        const costById = new Map<number, { paise: number | null; fallback: string | null }>();
        for (const [method, group] of byMethod.entries()) {
            const resolved = await resolveCostBatch(
                group.map((g) => ({
                    id:           g.id,
                    stock:        g.stock,
                    costPaise:    g.costPaise,
                    stdCostPaise: g.stdCostPaise,
                })),
                method,
            );
            for (const [id, r] of resolved) {
                costById.set(id, { paise: r.costPaise, fallback: r.fallback ?? null });
            }
        }

        let items: PricingItem[] = products.map((p) => {
            const cost  = costById.get(p.id) ?? { paise: p.costPaise, fallback: null };
            const meta  = matches.get(p.id)!;
            const matched = strategies.find((s) => s.id === meta.strategyId) ?? null;
            const priced = applyStrategy(
                cost.paise,
                p.marginPercent != null ? Number(p.marginPercent) : null,
                matched,
                p.mrpPaise,
            );
            const gstRatePct = taxByProduct.get(p.id)?.gstRate ?? 0;
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
                effectiveCostMethod:  meta.effectiveMethod,
                strategyCostMethod:   matched?.costMethod ?? null,
                marginPercent:     p.marginPercent != null ? Number(p.marginPercent) : null,
                priceOverridden:   p.priceOverridden,
                pricePaise:        p.pricePaise,
                mrpPaise:          p.mrpPaise,
                stdCostPaise:      p.stdCostPaise,
                lastPurchasePaise: p.costPaise,
                resolvedCostPaise:     cost.paise,
                resolvedCostFallback:  cost.fallback,
                computedPricePaise:    priced.pricePaise,
                rawComputedPricePaise: priced.rawPricePaise,
                cappedAtMrp:           priced.cappedAtMrp,
                strategyId:            meta.strategyId,
                strategyName:          meta.strategyName,
                appliedMarkupPct:      priced.appliedMarkupPct,
                appliedFlatPaise:      priced.appliedFlatPaise,
                appliedRoundingPaise:  priced.appliedRoundingPaise,
                gstRatePct,
            };
        });

        if (onlyAttention) {
            items = items.filter(
                (i) =>
                    i.resolvedCostPaise == null ||
                    i.mrpPaise == null || i.mrpPaise <= 0 ||
                    i.pricePaise == null,
            );
        }

        return NextResponse.json(items);
    } catch (e) {
        return handleApiError(e, "Failed to load pricing items");
    }
}
