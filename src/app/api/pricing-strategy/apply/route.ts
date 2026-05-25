import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { pricingApplySchema } from "@/shared/lib/schemas/pricingSchemas";
import { resolveCostBatch } from "@/modules/pricing-strategy/lib/resolveCost";
import { pickStrategy, applyStrategy } from "@/modules/pricing-strategy/lib/resolvePrice";

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

        const products = await prisma.invProduct.findMany({
            where,
            select: {
                id:            true,
                stock:         true,
                costPaise:     true,
                stdCostPaise:  true,
                mrpPaise:      true,
                categoryId:    true,
                groupId:       true,
                brandId:       true,
                costMethod:    true,
                marginPercent: true,
                priceOverridden: true,
            },
        });
        const strategies = await prisma.pricingStrategy.findMany({ where: { isActive: true } });

        // Pre-compute matched strategy + effective cost method per product
        // (product.costMethod ?? strategy.costMethod ?? hard fallback).
        type EffectiveMethod = Exclude<typeof products[number]["costMethod"], null>;
        const matched = new Map<number, { strategy: typeof strategies[number] | null; effectiveMethod: EffectiveMethod }>();
        for (const p of products) {
            const s = pickStrategy(
                {
                    id:            p.id,
                    categoryId:    p.categoryId,
                    groupId:       p.groupId,
                    brandId:       p.brandId,
                    marginPercent: p.marginPercent,
                },
                strategies,
            );
            const effective: EffectiveMethod =
                p.costMethod ?? s?.costMethod ?? "WEIGHTED_AVG_COST";
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
                group.map((g) => ({
                    id:           g.id,
                    stock:        g.stock,
                    costPaise:    g.costPaise,
                    stdCostPaise: g.stdCostPaise,
                })),
                method,
            );
            for (const [id, r] of resolved) costById.set(id, r.costPaise);
        }

        const result: ApplyResult = { updated: 0, skipped: 0, errors: [] };

        await prisma.$transaction(async (tx) => {
            for (const p of products) {
                if (!data.forceOverridden && p.priceOverridden && data.productIds && data.productIds.length > 0) {
                    // Explicit id list AND not forcing → still skip overridden.
                    result.skipped += 1;
                    continue;
                }
                const cost = costById.get(p.id) ?? p.costPaise;
                const priced = applyStrategy(
                    cost,
                    p.marginPercent != null ? Number(p.marginPercent) : null,
                    matched.get(p.id)!.strategy,
                    p.mrpPaise,
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
