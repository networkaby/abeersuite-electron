// Cost-basis resolver for the pricing-strategy module.
//
// Maps `enum CostMethod` (per-product) to a unit cost in paise. WEIGHTED_AVG_COST /
// FIFO / LAST_PURCHASE_COST delegate to `inventory/lib/valuation.ts` so stock
// valuation and pricing share one source of truth. MONTHLY_AVG_COST and
// STD_COST are pricing-specific:
//   • MONTHLY_AVG_COST → groupBy InvStockLedger over IN rows in the current
//     calendar month, weighted: Σ(amount) / Σ(qty).
//   • STD_COST         → read InvProduct.stdCostPaise verbatim.
//
// Every method falls back to InvProduct.costPaise (last purchase cost cached
// on the master) when no usable signal is found, so the resolver never throws
// "no data" for a product that has at least one PURCHASE on file.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { valueStockBatch, type ValuationMethod } from "@/modules/inventory/lib/valuation";
import { toNumber } from "@/modules/accountancy/lib/balance";
import type { CostMethod } from "@/generated/prisma/client";

export interface PricingProduct {
    id: number;
    stock: number | null;
    costPaise: number | null;
    stdCostPaise: number | null;
}

export type CostFallback =
    | "no-receipt-history"
    | "no-cost-basis"
    | "no-std-cost"
    | "no-month-history";

export interface ResolvedCost {
    productId: number;
    /** null when no usable cost data exists for the product. */
    costPaise: number | null;
    method: CostMethod;
    fallback?: CostFallback;
}

const COST_TO_VAL: Record<
    "WEIGHTED_AVG_COST" | "FIFO" | "LAST_PURCHASE_COST",
    ValuationMethod
> = {
    WEIGHTED_AVG_COST:  "WEIGHTED_AVG",
    FIFO:               "FIFO",
    LAST_PURCHASE_COST: "LAST_COST",
};

export async function resolveCostBatch(
    products: PricingProduct[],
    method: CostMethod,
): Promise<Map<number, ResolvedCost>> {
    const out = new Map<number, ResolvedCost>();
    if (products.length === 0) return out;

    if (method === "STD_COST") {
        for (const p of products) {
            if (p.stdCostPaise != null) {
                out.set(p.id, { productId: p.id, costPaise: p.stdCostPaise, method });
            } else {
                out.set(p.id, {
                    productId: p.id,
                    costPaise:  p.costPaise,
                    method,
                    fallback:   "no-std-cost",
                });
            }
        }
        return out;
    }

    if (method === "MONTHLY_AVG_COST") {
        const since = startOfCurrentMonth();
        const rows = await prisma.invStockLedger.groupBy({
            by:    ["productId"],
            where: {
                productId: { in: products.map((p) => p.id) },
                date:      { gte: since },
                inQty:     { gt: 0 },
                voucher:   { status: "POSTED" },
            },
            _sum: { inQty: true, amount: true },
        });
        const byId = new Map(rows.map((r) => [r.productId, r]));
        for (const p of products) {
            const r = byId.get(p.id);
            const totalQty = r?._sum.inQty != null ? toNumber(r._sum.inQty) : 0;
            const totalAmt = r?._sum.amount != null ? toNumber(r._sum.amount) : 0;
            if (totalQty > 0) {
                // amount is stored in rupees on InvStockLedger; convert to paise.
                out.set(p.id, {
                    productId: p.id,
                    costPaise:  Math.round((totalAmt / totalQty) * 100),
                    method,
                });
            } else {
                out.set(p.id, {
                    productId: p.id,
                    costPaise:  p.costPaise,
                    method,
                    fallback:   "no-month-history",
                });
            }
        }
        return out;
    }

    // Shared with stock valuation: delegate, convert rupees → paise.
    const valMethod = COST_TO_VAL[method as keyof typeof COST_TO_VAL];
    const vals = await valueStockBatch(
        products.map((p) => ({ id: p.id, stock: p.stock, costPaise: p.costPaise })),
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

export async function resolveCost(
    product: PricingProduct,
    method: CostMethod,
): Promise<ResolvedCost> {
    const m = await resolveCostBatch([product], method);
    return (
        m.get(product.id) ?? {
            productId: product.id,
            costPaise:  product.costPaise,
            method,
            fallback:   "no-cost-basis",
        }
    );
}

function startOfCurrentMonth(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
}
