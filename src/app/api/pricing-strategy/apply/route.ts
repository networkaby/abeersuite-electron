import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { pricingApplySchema } from "@/shared/lib/schemas/pricingSchemas";
import { resolveCostBatch } from "@/modules/pricing-strategy/lib/resolveCost";
import { loadStrategyPoints, additiveMarginPct, additivePrice } from "@/modules/pricing-strategy/lib/additiveMargin";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";

interface ApplyResult {
    updated: number;
    skipped: number;
    errors:  Array<{ productId: number; reason: string }>;
}

// Bulk-recompute effectiveSalePricePaise from the additive-margin engine (the
// STRATEGY source) + the per-item COMPUTED margin. SAVED + priceOverridden rows
// are left untouched (unless forceOverridden + explicit ids).
export async function POST(req: Request) {
    const { response } = await requireAnyPermission(PERMISSIONS.PRICING_STRATEGY_SET);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, pricingApplySchema);
        if (error) return error;

        const where = data.productIds && data.productIds.length > 0
            ? { id: { in: data.productIds }, isActive: true }
            : { isActive: true, ...(data.forceOverridden ? {} : { priceOverridden: false }) };

        const [products, points, orgDefaults] = await Promise.all([
            prisma.invProduct.findMany({
                where,
                select: {
                    id:            true,
                    stock:         true,
                    mrpPaise:      true,
                    categoryId:    true,
                    groupId:       true,
                    brandId:       true,
                    costMethod:    true,
                    marginPercent: true,
                    priceOverridden: true,
                    effectiveSalePriceSource: true,
                },
            }),
            loadStrategyPoints(),
            prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { valuationMethod: true } }),
        ]);
        const orgDefault = orgDefaults?.valuationMethod ?? "WEIGHTED_AVG";

        // Effective cost method: product override else org default.
        type EffectiveMethod = Exclude<typeof products[number]["costMethod"], null>;
        const effectiveMethodOf = (p: typeof products[number]): EffectiveMethod => p.costMethod ?? orgDefault;

        // Batch resolve costs grouped by effective method (skip SAVED + overridden).
        const byMethod = new Map<EffectiveMethod, typeof products>();
        for (const p of products) {
            if (p.effectiveSalePriceSource === "SAVED") continue;
            if (!data.forceOverridden && p.priceOverridden && (!data.productIds || data.productIds.length === 0)) continue;
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

        // Resolve GST so the written effectiveSalePricePaise is inclusive of tax.
        const taxResult = await resolveProductTaxBatch({ productIds: products.map((p) => p.id) });
        const taxByProduct = taxResult.products;

        const mrpCap = (val: number, mrp: number | null): number =>
            mrp != null && mrp > 0 ? Math.min(val, mrp) : val;

        const result: ApplyResult = { updated: 0, skipped: 0, errors: [] };

        await prisma.$transaction(async (tx) => {
            for (const p of products) {
                if (p.effectiveSalePriceSource === "SAVED") {
                    // SAVED products carry a human-frozen price; never clobber it.
                    result.skipped += 1;
                    continue;
                }
                if (!data.forceOverridden && p.priceOverridden && data.productIds && data.productIds.length > 0) {
                    // Explicit id list AND not forcing → still skip overridden.
                    result.skipped += 1;
                    continue;
                }
                const cost = costById.get(p.id) ?? null;
                const gstRatePct = taxByProduct.get(p.id)?.gstRate ?? 0;
                let price: number | null;
                if (p.effectiveSalePriceSource === "COMPUTED" && p.marginPercent != null && cost != null) {
                    // COMPUTED → cost × (1 + margin%), GST-inclusive, MRP-capped.
                    const gross = cost * (1 + Number(p.marginPercent) / 100) * (1 + gstRatePct / 100);
                    price = mrpCap(Math.round(gross), p.mrpPaise);
                } else {
                    // STRATEGY (default) → additive-margin engine (markup on cost).
                    price = additivePrice(cost, additiveMarginPct(p, points), p.mrpPaise, gstRatePct).pricePaise;
                }
                if (price == null) {
                    result.errors.push({ productId: p.id, reason: "No cost basis" });
                    continue;
                }
                await tx.invProduct.update({
                    where: { id: p.id },
                    data:  { effectiveSalePricePaise: price },
                });
                result.updated += 1;
            }
        });

        return NextResponse.json(result);
    } catch (e) {
        return handleApiError(e, "Failed to apply pricing");
    }
}
