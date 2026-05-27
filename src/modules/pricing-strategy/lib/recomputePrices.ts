// Auto-recompute pricing for a set of products. Invoked from every voucher
// poster after the stock-movement transaction commits — so the storefront
// price reflects the new cost basis immediately.
//
// Mirrors /api/pricing-strategy/apply's core math (extracted here so both can
// share it without making /apply a circular dependency on the voucher routes).
// Differences from /apply:
//   • Always scoped to a productIds list (callers pass the touched products).
//   • Always skips priceOverridden=true (no force flag).
//   • Designed to run as a sibling transaction AFTER voucher commit — failure
//     never rolls back the voucher; callers wrap in `.catch(...)`.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { resolveCostBatch } from "@/modules/pricing-strategy/lib/resolveCost";
import { applyStrategy } from "@/modules/pricing-strategy/lib/resolvePrice";
import { pickStrategy, buildMatchContext } from "@/modules/pricing-strategy/lib/matchStrategy";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { valueStockBatch } from "@/modules/inventory/lib/valuation";

export interface RecomputeResult {
    /** Products whose `pricePaise` was rewritten. */
    updated: number;
    /** Skipped: priceOverridden=true, or no cost basis, or inactive. */
    skipped: number;
    /** Products that errored mid-write (Sentry captured by caller). */
    failed:  number;
}

/**
 * Recompute and write `pricePaise` (GST-inclusive) for each given product.
 * No-op when `productIds` is empty.
 */
export async function recomputePricesForProducts(
    productIds: number[],
): Promise<RecomputeResult> {
    const result: RecomputeResult = { updated: 0, skipped: 0, failed: 0 };
    if (productIds.length === 0) return result;

    const uniqueIds = [...new Set(productIds)];

    const [products, strategies, orgDefaults] = await Promise.all([
        prisma.invProduct.findMany({
            where:  { id: { in: uniqueIds }, isActive: true },
            select: {
                id:              true,
                stock:           true,
                mrpPaise:        true,
                categoryId:      true,
                groupId:         true,
                brandId:         true,
                attrsJson:       true,
                costMethod:      true,
                marginPercent:   true,
                priceOverridden: true,
            },
        }),
        prisma.pricingStrategy.findMany({ where: { isActive: true } }),
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { valuationMethod: true } }),
    ]);

    if (products.length === 0) return result;

    const orgDefault = orgDefaults?.valuationMethod ?? "WEIGHTED_AVG";

    // Match context — same shape as /apply.
    const needsStaleness = strategies.some((s) => s.minStaleDays != null || s.maxStaleDays != null);
    const matchCtx = await buildMatchContext({
        productIdsForStaleness: needsStaleness ? products.map((p) => p.id) : [],
    });

    // Pre-resolve LAST_INWARD for the matcher's cost-range filter. Matches
    // pre-PR3 behaviour where `costPaise` (the cache) drove min/maxCostPaise
    // strategy gates; the cache itself was always overwritten with the most
    // recent inward rate, so LAST_INWARD is the same signal.
    const matcherCosts = await valueStockBatch(
        products.map((p) => ({ id: p.id, stock: p.stock })),
        "LAST_INWARD",
    );

    type EffectiveMethod = Exclude<typeof products[number]["costMethod"], null>;
    const matched = new Map<number, { strategy: typeof strategies[number] | null; effectiveMethod: EffectiveMethod }>();
    for (const p of products) {
        const mc = matcherCosts.get(p.id);
        const matcherCostPaise = mc && mc.unitCost > 0 ? Math.round(mc.unitCost * 100) : null;
        const s = pickStrategy(
            {
                id:         p.id,
                brandId:    p.brandId,
                groupId:    p.groupId,
                categoryId: p.categoryId,
                costPaise:  matcherCostPaise,
                stock:      p.stock,
                attrsJson:  (p.attrsJson ?? null) as Record<string, unknown> | null,
            },
            strategies,
            matchCtx,
        );
        const effective: EffectiveMethod = p.costMethod ?? s?.costMethod ?? orgDefault;
        matched.set(p.id, { strategy: s, effectiveMethod: effective });
    }

    // Batch cost resolution grouped by effective method (one query per method).
    const byMethod = new Map<EffectiveMethod, typeof products>();
    for (const p of products) {
        if (p.priceOverridden) continue;
        const m = matched.get(p.id)!.effectiveMethod;
        const arr = byMethod.get(m);
        if (arr) arr.push(p); else byMethod.set(m, [p]);
    }
    const costById = new Map<number, number | null>();
    for (const [method, group] of byMethod.entries()) {
        const resolved = await resolveCostBatch(
            group.map((g) => ({ id: g.id, stock: g.stock })),
            method,
        );
        for (const [id, r] of resolved) costById.set(id, r.costPaise);
    }

    // GST so the written price is inclusive.
    const taxResult = await resolveProductTaxBatch({ productIds: products.map((p) => p.id) });
    const taxByProduct = taxResult.products;

    await prisma.$transaction(async (tx) => {
        for (const p of products) {
            if (p.priceOverridden) {
                result.skipped += 1;
                continue;
            }
            const cost       = costById.get(p.id) ?? null;
            const gstRatePct = taxByProduct.get(p.id)?.gstRate ?? 0;
            const priced     = applyStrategy(
                cost,
                p.marginPercent != null ? Number(p.marginPercent) : null,
                matched.get(p.id)!.strategy,
                p.mrpPaise,
                gstRatePct,
            );
            if (priced.pricePaise == null) {
                result.skipped += 1;
                continue;
            }
            try {
                await tx.invProduct.update({
                    where: { id: p.id },
                    data:  { pricePaise: priced.pricePaise },
                });
                result.updated += 1;
            } catch {
                result.failed += 1;
            }
        }
    });

    return result;
}
