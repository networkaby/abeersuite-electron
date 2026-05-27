import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { pricingApplySchema } from "@/shared/lib/schemas/pricingSchemas";
import { resolveCostBatch } from "@/modules/pricing-strategy/lib/resolveCost";
import { applyStrategy } from "@/modules/pricing-strategy/lib/resolvePrice";
import { pickStrategy, buildMatchContext } from "@/modules/pricing-strategy/lib/matchStrategy";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { valueStockBatch } from "@/modules/inventory/lib/valuation";

interface ApplyResult {
    updated: number;
    skipped: number;
    errors:  Array<{ productId: number; reason: string }>;
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, pricingApplySchema);
        if (error) return error;

        const where = data.productIds && data.productIds.length > 0
            ? { id: { in: data.productIds }, isActive: true }
            : { isActive: true, ...(data.forceOverridden ? {} : { priceOverridden: false }) };

        const [products, strategies, orgDefaults] = await Promise.all([
            prisma.invProduct.findMany({
                where,
                select: {
                    id:            true,
                    stock:         true,
                    mrpPaise:      true,
                    categoryId:    true,
                    groupId:       true,
                    brandId:       true,
                    attrsJson:     true,
                    costMethod:    true,
                    marginPercent: true,
                    priceOverridden: true,
                },
            }),
            prisma.pricingStrategy.findMany({ where: { isActive: true } }),
            prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { valuationMethod: true } }),
        ]);
        const orgDefault = orgDefaults?.valuationMethod ?? "WEIGHTED_AVG";

        // Build match context once; query lastSaleAgeDays only when needed.
        const needsStaleness = strategies.some((s) => s.minStaleDays != null || s.maxStaleDays != null);
        const matchCtx = await buildMatchContext({
            productIdsForStaleness: needsStaleness ? products.map((p) => p.id) : [],
        });

        // Pre-resolve LAST_INWARD as the matcher's cost signal (drives the
        // cost-range filter on PricingStrategy). Matches pre-PR3 semantics
        // where the now-removed costPaise cache was always the most recent
        // inward rate.
        const matcherCosts = await valueStockBatch(
            products.map((p) => ({ id: p.id, stock: p.stock })),
            "LAST_INWARD",
        );

        // Pre-compute matched strategy + effective cost method per product
        // (product.costMethod ?? strategy.costMethod ?? OrgDefaults.valuationMethod).
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

        // Batch resolve costs grouped by effective method.
        const byMethod = new Map<EffectiveMethod, typeof products>();
        for (const p of products) {
            if (!data.forceOverridden && p.priceOverridden && (!data.productIds || data.productIds.length === 0)) continue;
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

        // Resolve GST so the written pricePaise is inclusive of tax.
        const taxResult = await resolveProductTaxBatch({ productIds: products.map((p) => p.id) });
        const taxByProduct = taxResult.products;

        const result: ApplyResult = { updated: 0, skipped: 0, errors: [] };

        await prisma.$transaction(async (tx) => {
            for (const p of products) {
                if (!data.forceOverridden && p.priceOverridden && data.productIds && data.productIds.length > 0) {
                    // Explicit id list AND not forcing → still skip overridden.
                    result.skipped += 1;
                    continue;
                }
                const cost = costById.get(p.id) ?? null;
                const gstRatePct = taxByProduct.get(p.id)?.gstRate ?? 0;
                const priced = applyStrategy(
                    cost,
                    p.marginPercent != null ? Number(p.marginPercent) : null,
                    matched.get(p.id)!.strategy,
                    p.mrpPaise,
                    gstRatePct,
                );
                if (priced.pricePaise == null) {
                    result.errors.push({ productId: p.id, reason: "No cost basis" });
                    continue;
                }
                await tx.invProduct.update({
                    where: { id: p.id },
                    data:  { pricePaise: priced.pricePaise },
                });
                result.updated += 1;
            }
        });

        return NextResponse.json(result);
    } catch (e) {
        return handleApiError(e, "Failed to apply pricing");
    }
}
