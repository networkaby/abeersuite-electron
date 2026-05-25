import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { resolveCostBatch } from "@/modules/pricing-strategy/lib/resolveCost";
import { pickStrategy, applyStrategy } from "@/modules/pricing-strategy/lib/resolvePrice";

export interface PricingItem {
    id:               number;
    sku:              string;
    name:             string;
    categoryName:     string | null;
    groupName:        string | null;
    brandName:        string | null;
    costMethod:       string;
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
}

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
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
                    category: { select: { name: true } },
                    group:    { select: { name: true } },
                    brand:    { select: { name: true } },
                },
            }),
            prisma.pricingStrategy.findMany({ where: { isActive: true } }),
        ]);

        // Group products by costMethod so we issue one batch per method.
        const byMethod = new Map<string, typeof products>();
        for (const p of products) {
            const arr = byMethod.get(p.costMethod);
            if (arr) arr.push(p); else byMethod.set(p.costMethod, [p]);
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
                method as Parameters<typeof resolveCostBatch>[1],
            );
            for (const [id, r] of resolved) {
                costById.set(id, { paise: r.costPaise, fallback: r.fallback ?? null });
            }
        }

        const items: PricingItem[] = products.map((p) => {
            const cost = costById.get(p.id) ?? { paise: p.costPaise, fallback: null };
            const matched = pickStrategy(
                {
                    id:            p.id,
                    categoryId:    p.categoryId,
                    groupId:       p.groupId,
                    brandId:       p.brandId,
                    marginPercent: p.marginPercent,
                },
                strategies,
            );
            const priced = applyStrategy(
                cost.paise,
                p.marginPercent != null ? Number(p.marginPercent) : null,
                matched,
                p.mrpPaise,
            );
            return {
                id:                p.id,
                sku:               p.sku,
                name:              p.name,
                categoryName:      p.category?.name ?? null,
                groupName:         p.group?.name ?? null,
                brandName:         p.brand?.name ?? null,
                costMethod:        p.costMethod,
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
                strategyId:            matched?.id ?? null,
                strategyName:          matched?.name ?? null,
                appliedMarkupPct:      priced.appliedMarkupPct,
            };
        });

        return NextResponse.json(items);
    } catch (e) {
        return handleApiError(e, "Failed to load pricing items");
    }
}
