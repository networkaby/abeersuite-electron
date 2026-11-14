// Auto-recompute pricing for a set of products. Invoked from every voucher
// poster after the stock-movement transaction commits — so the storefront /
// POS price reflects the new cost basis immediately.
//
//   • Always scoped to a productIds list (callers pass the touched products).
//   • SAVED rows materialize from savedSalePricePaise without needing cost.
//   • Designed to run as a sibling transaction AFTER voucher commit — failure
//     never rolls back the voucher; callers wrap in `.catch(...)`.
//
// The STRATEGY source is materialized by the additive-margin engine
// (`additiveMargin.ts`) — base + brand + category + group points. (The old
// PricingStrategy engine was dropped.)

import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { resolveCostBatch } from "@/modules/pricing-strategy/lib/resolveCost";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { loadStrategyPoints, additiveMarginPct, additivePriceWithSurcharge, marginForPrice } from "@/modules/pricing-strategy/lib/additiveMargin";
import { getCurrentAdditionalCostByProduct } from "@/modules/pricing-strategy/lib/costPool";
import { saveAutoBarcodes } from "@/modules/pricing-strategy/lib/barcodeStore";

export interface RecomputeResult {
    /** Products whose `effectiveSalePricePaise` was rewritten. */
    updated: number;
    /** Skipped: no cost basis, or no margin to apply. */
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
    const expiredTemp = await endTempPricesAfterPurchase(uniqueIds);

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
    // are excluded from the cost batch.
    const byMethod = new Map<EffectiveMethod, typeof products>();
    for (const p of products) {
        if (p.effectiveSalePriceSource === "SAVED") continue;
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

    // GST so the written price is inclusive. The additional cost (shipping /
    // courier, Costing page) folds in before GST — exactly as the Update prices
    // screen's Computed / Strategy columns do, so the floor POS reads (Lowest)
    // is the number that screen shows.
    const [taxResult, additionalById] = await Promise.all([
        resolveProductTaxBatch({ productIds: products.map((p) => p.id) }),
        getCurrentAdditionalCostByProduct(products.map((p) => p.id)),
    ]);
    const taxByProduct = taxResult.products;

    const mrpCap = (val: number, mrp: number | null): number =>
        mrp != null && mrp > 0 ? Math.min(val, mrp) : val;

    await prisma.$transaction(async (tx) => {
        for (const p of products) {
            const gstRatePct = taxByProduct.get(p.id)?.gstRate ?? 0;
            let effective: number | null;
            let newMargin: number | null = null;
            const computed = p.effectiveSalePriceSource === "COMPUTED";
            const cost = costById.get(p.id) ?? null;

            if (p.effectiveSalePriceSource === "SAVED" && p.savedSalePricePaise != null) {
                // SAVED → the human price, MRP-capped. No cost needed.
                effective = mrpCap(p.savedSalePricePaise, p.mrpPaise);
            } else if (computed && cost == null && p.savedSalePricePaise != null) {
                // COMPUTED with no cost yet (new product, nothing bought) →
                // the Saved price is the fallback until a cost lands.
                effective = mrpCap(p.savedSalePricePaise, p.mrpPaise);
            } else {
                const extra = additionalById.get(p.id) ?? 0;
                // COMPUTED with no margin yet but a Saved price → its first
                // margin is the one that makes cost reach the Saved price
                // (a product created with a sell price, e.g. from a purchase).
                if (computed && p.marginPercent == null && p.savedSalePricePaise != null) {
                    newMargin = marginForPrice(cost, extra, mrpCap(p.savedSalePricePaise, p.mrpPaise), gstRatePct);
                }
                // COMPUTED → the product's own margin %; STRATEGY (default) →
                // the additive-margin engine. Both mark up the landed cost.
                const margin = newMargin != null ? newMargin
                    : computed && p.marginPercent != null ? Number(p.marginPercent)
                    : additiveMarginPct(p, points);
                effective = additivePriceWithSurcharge(cost, extra, margin, p.mrpPaise, gstRatePct).pricePaise;
            }

            if (effective == null) {
                result.skipped += 1;
                continue;
            }
            try {
                await tx.invProduct.update({
                    where: { id: p.id },
                    data:  {
                        effectiveSalePricePaise: effective,
                        ...(newMargin != null ? { marginPercent: newMargin.toFixed(2) } : {}),
                    },
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

    // A temporary Fixed Price just ended → the public price goes back to auto
    // from the new lowest price, like any freshly priced product.
    if (expiredTemp.length) {
        await saveAutoBarcodes(expiredTemp).catch((err: unknown) => {
            Sentry.captureException(err, { tags: { source: "price-recompute", via: "temp-price-end" } });
        });
    }

    return result;
}

/**
 * Fixed Price "until next purchase": end it for every product that has had a
 * posted PURCHASE / GRN stock row since it was saved. The original selling
 * choice and Fixed Price come back (Strategy / Computed / an older Fixed Price).
 * Returns the ended ids.
 */
async function endTempPricesAfterPurchase(ids: number[]): Promise<number[]> {
    const temp = await prisma.invProduct.findMany({
        where:  { id: { in: ids }, tempPriceAfterLedgerId: { not: null } },
        select: { id: true, tempPriceAfterLedgerId: true, tempRestoreSource: true, tempRestoreSalePaise: true },
    });
    if (temp.length === 0) return [];
    const minMark = Math.min(...temp.map((t) => t.tempPriceAfterLedgerId!));
    const rows = await prisma.invStockLedger.findMany({
        where: {
            productId:        { in: temp.map((t) => t.id) },
            id:               { gt: minMark },
            inQty:            { gt: 0 },
            reversalOfId:     null,
            universalVoucher: { type: { in: ["PURCHASE", "GRN"] }, status: "POSTED" },
        },
        select: { productId: true, id: true },
    });
    const ended = temp.filter((t) => rows.some((r) => r.productId === t.id && r.id > t.tempPriceAfterLedgerId!));
    if (ended.length === 0) return [];
    await prisma.$transaction(ended.map((t) => prisma.invProduct.update({
        where: { id: t.id },
        data:  {
            effectiveSalePriceSource: t.tempRestoreSource ?? "STRATEGY",
            savedSalePricePaise:      t.tempRestoreSalePaise,
            tempPriceAfterLedgerId:   null,
            tempPriceSetAt:           null,
            tempRestoreSource:        null,
            tempRestoreSalePaise:     null,
        },
    })));
    return ended.map((t) => t.id);
}

/**
 * Fire-and-report recompute for a route that has already saved its own work —
 * a failure is logged, never thrown, so the caller's response is unaffected.
 */
export async function recomputePricesQuietly(productIds: Array<number | null | undefined>, source: string): Promise<void> {
    const ids = productIds.filter((id): id is number => id != null);
    await recomputePricesForProducts(ids).catch((err: unknown) => {
        Sentry.captureException(err, { tags: { source: "price-recompute", via: source } });
        console.error(`[price-recompute] ${source} failed for`, ids, err);
    });
}
