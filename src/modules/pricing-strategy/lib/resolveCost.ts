// Cost-basis resolver for the pricing-strategy module.
//
// Single source of truth: `InvStockLedger` rows (opening + every voucher
// inward), walked via `valueStockBatch`. The cached `InvProduct.costPaise`
// column was removed in PR 3 of noble-boole; every method now derives cost
// directly from the ledger and opening master fields.
//
// Methods: WEIGHTED_AVG | SIMPLE_AVG | FIFO | LAST_INWARD | MONTHLY_AVG.
// `STD_COST` was dropped (dead weight); `LIFO` was dropped (banned for
// Indian tax reporting).
//
// Fallback chain — shared by every method:
//   method-empty → LAST_INWARD → openingRate → no-cost-basis (Needs Attention).

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { valueStockBatch, type ValuationMethod } from "@/modules/inventory/lib/valuation";
import { toNumber } from "@/modules/accountancy/lib/balance";
import type { CostMethod } from "@/generated/prisma/client";

export interface PricingProduct {
    id: number;
    stock: number | null;
}

export type CostFallback =
    | "no-receipt-history"
    | "no-cost-basis"
    | "no-month-history";

export interface ResolvedCost {
    productId: number;
    /** null when no usable cost data exists for the product. */
    costPaise: number | null;
    method: CostMethod;
    fallback?: CostFallback;
}

// All CostMethod values are also ValuationMethod values (same names since PR 3).
const COST_TO_VAL: Record<CostMethod, ValuationMethod> = {
    WEIGHTED_AVG: "WEIGHTED_AVG",
    SIMPLE_AVG:   "SIMPLE_AVG",
    FIFO:         "FIFO",
    LAST_INWARD:  "LAST_INWARD",
    MONTHLY_AVG:  "MONTHLY_AVG",
};

export async function resolveCostBatch(
    products: PricingProduct[],
    method: CostMethod,
): Promise<Map<number, ResolvedCost>> {
    const out = new Map<number, ResolvedCost>();
    if (products.length === 0) return out;

    if (method === "MONTHLY_AVG") {
        const since = startOfCurrentMonth();
        const rows = await prisma.invStockLedger.groupBy({
            by:    ["productId"],
            where: {
                productId: { in: products.map((p) => p.id) },
                date:      { gte: since },
                inQty:     { gt: 0 },
                universalVoucher: { status: "POSTED" },
            },
            _sum: { inQty: true, amount: true },
        });
        const byId = new Map(rows.map((r) => [r.productId, r]));

        // Fallback to LAST_INWARD for products with no purchases this month.
        const noMonthIds = products.filter((p) => {
            const r = byId.get(p.id);
            return r == null || r._sum.inQty == null || toNumber(r._sum.inQty) <= 0;
        });
        const fallbackVals = noMonthIds.length > 0
            ? await valueStockBatch(noMonthIds, "LAST_INWARD")
            : new Map();

        for (const p of products) {
            const r = byId.get(p.id);
            const totalQty = r?._sum.inQty != null ? toNumber(r._sum.inQty) : 0;
            const totalAmt = r?._sum.amount != null ? toNumber(r._sum.amount) : 0;
            if (totalQty > 0) {
                out.set(p.id, {
                    productId: p.id,
                    // amount on InvStockLedger is rupees; convert to paise.
                    costPaise:  Math.round((totalAmt / totalQty) * 100),
                    method,
                });
            } else {
                const fb = fallbackVals.get(p.id);
                const paise = fb && fb.unitCost > 0 ? Math.round(fb.unitCost * 100) : null;
                out.set(p.id, {
                    productId: p.id,
                    costPaise:  paise,
                    method,
                    fallback:   paise != null ? "no-month-history" : "no-cost-basis",
                });
            }
        }
        return out;
    }

    // WEIGHTED_AVG / SIMPLE_AVG / FIFO / LAST_INWARD — delegate to the
    // shared ledger walk; convert rupees → paise.
    const valMethod = COST_TO_VAL[method];
    const vals = await valueStockBatch(
        products.map((p) => ({ id: p.id, stock: p.stock })),
        valMethod,
    );
    for (const p of products) {
        const v = vals.get(p.id);
        if (!v) continue;
        const paise = v.unitCost > 0 ? Math.round(v.unitCost * 100) : null;
        const entry: ResolvedCost = { productId: p.id, costPaise: paise, method };
        if (v.fallback === "no-receipt-history") entry.fallback = "no-receipt-history";
        else if (v.fallback === "no-cost-basis") entry.fallback = "no-cost-basis";
        out.set(p.id, entry);
    }
    return out;
}

/// One-call effective cost per product (paise, GST-EXCLUSIVE): resolves each
/// product's cost by its OWN effective method (product.costMethod ??
/// OrgDefaults.valuationMethod), batched per method. The single shared basis for
/// every "% of cost" consumer — pricing apply, POS lookup snapshot, the POS
/// spend-tier discount, and %-type coupons — so they can never disagree.
export async function resolveEffectiveCostMap(productIds: number[]): Promise<Map<number, number | null>> {
    const out = new Map<number, number | null>();
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return out;
    const [orgDefaults, products] = await Promise.all([
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { valuationMethod: true } }),
        prisma.invProduct.findMany({ where: { id: { in: ids } }, select: { id: true, stock: true, costMethod: true } }),
    ]);
    const orgMethod: CostMethod = orgDefaults?.valuationMethod ?? "WEIGHTED_AVG";
    const byMethod = new Map<CostMethod, PricingProduct[]>();
    for (const p of products) {
        const m = p.costMethod ?? orgMethod;
        const bucket = byMethod.get(m) ?? [];
        bucket.push({ id: p.id, stock: p.stock });
        byMethod.set(m, bucket);
    }
    for (const [method, group] of byMethod.entries()) {
        const resolved = await resolveCostBatch(group, method);
        for (const [id, r] of resolved) out.set(id, r.costPaise);
    }
    return out;
}

export async function resolveCost(
    product: PricingProduct,
    method: CostMethod,
): Promise<ResolvedCost> {
    const m = await resolveCostBatch([product], method);
    return (
        m.get(product.id) ?? {
            productId: product.id,
            costPaise:  null,
            method,
            fallback:   "no-cost-basis",
        }
    );
}

function startOfCurrentMonth(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
}
