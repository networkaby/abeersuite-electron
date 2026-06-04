// Auto-recompute pricing for a set of products. Invoked from every voucher
// poster after the stock-movement transaction commits — so the storefront /
// POS price reflects the new cost basis immediately.
//
//   • Always scoped to a productIds list (callers pass the touched products).
//   • Skips priceOverridden=true (manual price lock) and SAVED rows materialize
//     from savedSalePricePaise without needing cost.
//   • Designed to run as a sibling transaction AFTER voucher commit — failure
//     never rolls back the voucher; callers wrap in `.catch(...)`.
//
// The STRATEGY source is materialized by the additive-margin engine
// (`additiveMargin.ts`) — base + brand + category + group points. (The old
// PricingStrategy engine was dropped.)

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { resolveCostBatch } from "@/modules/pricing-strategy/lib/resolveCost";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { loadStrategyPoints, additiveMarginPct, additivePrice } from "@/modules/pricing-strategy/lib/additiveMargin";

export interface RecomputeResult {
    /** Products whose `effectiveSalePricePaise` was rewritten. */
    updated: number;
    /** Skipped: priceOverridden=true, or no cost basis, or inactive. */
    skipped: number;
    /** Products that errored mid-write (Sentry captured by caller). */
    failed:  number;
}

/**
 * Recompute and write `effectiveSalePricePaise` (GST-inclusive) for each product,
 * materialized from the product's `effectiveSalePriceSource` (SAVED/COMPUTED/STRATEGY).
 * No-op when `productIds` is empty.
 */
export async function recomputePricesForProducts(
    productIds: number[],
): Promise<RecomputeResult> {
    const result: RecomputeResult = { updated: 0, skipped: 0, failed: 0 };
    if (productIds.length === 0) return result;

    const uniqueIds = [...new Set(productIds)];

    const [products, points, orgDefaults] = await Promise.all([
        prisma.invProduct.findMany({
            where:  { id: { in: uniqueIds }, isActive: true },
            select: {
                id:                       true,
                stock:                    true,
                mrpPaise:                 true,
                categoryId:               true,
                groupId:                  true,
                brandId:                  true,
                costMethod:               true,
                marginPercent:            true,
                priceOverridden:          true,
                effectiveSalePriceSource: true,
                savedSalePricePaise:      true,
            },
        }),
        loadStrategyPoints(),
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { valuationMethod: true } }),
    ]);

    if (products.length === 0) return result;

    const orgDefault = orgDefaults?.valuationMethod ?? "WEIGHTED_AVG";

    // Effective cost method: product override else org default. (No strategy tier
    // anymore — PricingStrategy was dropped.)
    type EffectiveMethod = Exclude<typeof products[number]["costMethod"], null>;
    const effectiveMethodOf = (p: typeof products[number]): EffectiveMethod => p.costMethod ?? orgDefault;

    // Batch cost resolution grouped by effective method (one query per method).
    // SAVED rows materialize from savedSalePricePaise and never need cost, so they
    // are excluded from the cost batch (and from priceOverridden skipping).
    const byMethod = new Map<EffectiveMethod, typeof products>();
    for (const p of products) {
        if (p.effectiveSalePriceSource === "SAVED") continue;
        if (p.priceOverridden) continue;
        const m = effectiveMethodOf(p);
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

    const mrpCap = (val: number, mrp: number | null): number =>
        mrp != null && mrp > 0 ? Math.min(val, mrp) : val;

    await prisma.$transaction(async (tx) => {
        for (const p of products) {
            const gstRatePct = taxByProduct.get(p.id)?.gstRate ?? 0;
            let effective: number | null;

            if (p.effectiveSalePriceSource === "SAVED" && p.savedSalePricePaise != null) {
                // SAVED → the human price, MRP-capped. Wins even over priceOverridden
                // (it is itself an explicit human choice). No cost needed.
                effective = mrpCap(p.savedSalePricePaise, p.mrpPaise);
            } else if (p.priceOverridden) {
                // Manual effectiveSalePricePaise set on the items page — leave it.
                result.skipped += 1;
                continue;
            } else {
                const cost = costById.get(p.id) ?? null;
                if (p.effectiveSalePriceSource === "COMPUTED" && p.marginPercent != null && cost != null) {
                    // COMPUTED → cost × (1 + margin%), GST-inclusive, MRP-capped.
                    const raw   = cost * (1 + Number(p.marginPercent) / 100);
                    const gross = raw * (1 + gstRatePct / 100);
                    effective   = mrpCap(Math.round(gross), p.mrpPaise);
                } else {
                    // STRATEGY (default) → additive-margin engine (markup on cost).
                    effective = additivePrice(cost, additiveMarginPct(p, points), p.mrpPaise, gstRatePct).pricePaise;
                }
            }

            if (effective == null) {
                result.skipped += 1;
                continue;
            }
            try {
                await tx.invProduct.update({
                    where: { id: p.id },
                    data:  { effectiveSalePricePaise: effective },
                });
                result.updated += 1;
            } catch {
                result.failed += 1;
            }
        }
    // Per-product update loop is bounded-small on the post path (only the
    // voucher's products) but unbounded on the bulk recompute path — over the
    // Supabase pooler a large batch overruns the default 5s tx ceiling (P2028).
    }, { timeout: 60_000, maxWait: 15_000 });

    return result;
}
