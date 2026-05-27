// Pluggable stock-valuation strategies. Single source of truth =
// `InvStockLedger` rows (every voucher inward, including PHYSICAL_STOCK which
// stamps a synthetic rate at post time) + opening master fields on
// `InvProduct` (treated as a synthetic first lot). The cached
// `InvProduct.costPaise` column was removed in PR 3 of noble-boole — every
// method derives unit cost from the ledger walk now.
//
// Methods:
//   LAST_INWARD   — most recent inward lot's rate
//   WEIGHTED_AVG  — Σ(qty × rate) / Σ(qty) across all inward lots
//   SIMPLE_AVG    — Σ(rate) / N (plain arithmetic mean, qty doesn't weight)
//   FIFO          — walk lots newest-first against on-hand qty
//   MONTHLY_AVG   — WEIGHTED_AVG restricted to current calendar month
//
// Cascading fallback (shared by every method):
//   method-empty → LAST_INWARD → openingRate → no-cost-basis (Needs Attention).

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";

export type ValuationMethod =
    | "LAST_INWARD"
    | "WEIGHTED_AVG"
    | "SIMPLE_AVG"
    | "FIFO"
    | "MONTHLY_AVG";

export const VALUATION_METHODS: ValuationMethod[] = [
    "LAST_INWARD",
    "WEIGHTED_AVG",
    "SIMPLE_AVG",
    "FIFO",
    "MONTHLY_AVG",
];

export interface ProductValuation {
    productId: number;
    qty: number;
    /** ₹ per unit, method-dependent. 0 when cost basis unknown. */
    unitCost: number;
    /** ₹ — qty × unitCost. 0 when qty ≤ 0. */
    value: number;
    method: ValuationMethod;
    fallback?: "no-receipt-history" | "no-cost-basis";
}

export interface ProductMaster {
    id: number;
    stock: number | null;
}

type Lot = { date: Date; id: number; qty: number; rate: number };

/**
 * Fetch every inward lot for the given products. Returns:
 *   • All InvStockLedger rows with inQty > 0 from POSTED, non-deleted vouchers
 *     (NO voucher.type filter — PHYSICAL_STOCK rows stamp a rate at post time).
 *   • A synthetic first lot per product when openingStock > 0 && openingRate
 *     is set, sorted oldest-first by date.
 */
async function loadInwardLots(productIds: number[]): Promise<Map<number, Lot[]>> {
    if (productIds.length === 0) return new Map();

    const [rows, masters] = await Promise.all([
        prisma.invStockLedger.findMany({
            where:   {
                productId: { in: productIds },
                inQty:     { gt: 0 },
                voucher:   { status: "POSTED", deletedAt: null },
            },
            select:  { id: true, productId: true, date: true, inQty: true, rate: true },
            orderBy: [{ date: "asc" }, { id: "asc" }],
        }),
        prisma.invProduct.findMany({
            where:  { id: { in: productIds } },
            select: { id: true, openingStock: true, openingRate: true, openingStockDate: true },
        }),
    ]);

    const map = new Map<number, Lot[]>();
    for (const r of rows) {
        const lot: Lot = {
            date: r.date,
            id:   r.id,
            qty:  toNumber(r.inQty),
            rate: toNumber(r.rate),
        };
        const arr = map.get(r.productId);
        if (arr) arr.push(lot); else map.set(r.productId, [lot]);
    }

    for (const m of masters) {
        const openQty  = m.openingStock != null ? toNumber(m.openingStock) : 0;
        const openRate = m.openingRate != null ? toNumber(m.openingRate) : 0;
        if (!(openQty > 0) || !(openRate > 0)) continue;
        const openingLot: Lot = {
            date: m.openingStockDate ?? new Date(0),
            id:   -1, // synthetic; never collides with InvStockLedger.id (positive)
            qty:  openQty,
            rate: openRate,
        };
        const arr = map.get(m.id);
        if (arr) {
            // Keep oldest first; opening goes to the front when same/earlier date.
            arr.unshift(openingLot);
            arr.sort((a, b) => {
                const d = a.date.getTime() - b.date.getTime();
                return d !== 0 ? d : a.id - b.id;
            });
        } else {
            map.set(m.id, [openingLot]);
        }
    }
    return map;
}

/** Pull just the opening rate for a product (used as the lowest-level fallback). */
async function loadOpeningRates(productIds: number[]): Promise<Map<number, number>> {
    if (productIds.length === 0) return new Map();
    const masters = await prisma.invProduct.findMany({
        where:  { id: { in: productIds } },
        select: { id: true, openingRate: true },
    });
    const map = new Map<number, number>();
    for (const m of masters) {
        if (m.openingRate != null) {
            const n = toNumber(m.openingRate);
            if (n > 0) map.set(m.id, n);
        }
    }
    return map;
}

// ── Per-method math ─────────────────────────────────────────────────────────

function lastInward(p: ProductMaster, lots: Lot[]): ProductValuation {
    const qty = p.stock ?? 0;
    const unitCost = lots[lots.length - 1].rate;
    return {
        productId: p.id,
        qty,
        unitCost,
        value: qty > 0 ? qty * unitCost : 0,
        method: "LAST_INWARD",
    };
}

function weightedAvg(p: ProductMaster, lots: Lot[]): ProductValuation {
    const qty = p.stock ?? 0;
    let totalQty = 0;
    let totalValue = 0;
    for (const lot of lots) {
        totalQty   += lot.qty;
        totalValue += lot.qty * lot.rate;
    }
    const unitCost = totalQty > 0 ? totalValue / totalQty : 0;
    return {
        productId: p.id,
        qty,
        unitCost,
        value: qty > 0 ? qty * unitCost : 0,
        method: "WEIGHTED_AVG",
    };
}

function simpleAvg(p: ProductMaster, lots: Lot[]): ProductValuation {
    const qty = p.stock ?? 0;
    const sum = lots.reduce((s, l) => s + l.rate, 0);
    const unitCost = lots.length > 0 ? sum / lots.length : 0;
    return {
        productId: p.id,
        qty,
        unitCost,
        value: qty > 0 ? qty * unitCost : 0,
        method: "SIMPLE_AVG",
    };
}

// FIFO: oldest receipts consumed first by sales. Remaining on-hand qty is
// priced at the most-recent surviving lots. We walk lots in REVERSE
// chronological order, filling qty from the most recent lots backward.
// This produces the same surviving-lot composition as a full FIFO replay
// against perfectly matched inward/outward totals.
function fifo(p: ProductMaster, lots: Lot[]): ProductValuation {
    const qty = p.stock ?? 0;
    if (qty <= 0) {
        return { productId: p.id, qty, unitCost: 0, value: 0, method: "FIFO" };
    }
    let remaining = qty;
    let accValue = 0;
    for (let i = lots.length - 1; i >= 0 && remaining > 0; i -= 1) {
        const lot = lots[i];
        const take = Math.min(remaining, lot.qty);
        accValue  += take * lot.rate;
        remaining -= take;
    }
    if (remaining > 0) {
        // On-hand exceeds total inward (return/adjustment) — value the rest at
        // the oldest known rate so we don't under-count.
        accValue += remaining * lots[0].rate;
    }
    const unitCost = qty > 0 ? accValue / qty : 0;
    return { productId: p.id, qty, unitCost, value: accValue, method: "FIFO" };
}

function monthlyAvg(p: ProductMaster, lots: Lot[]): ProductValuation {
    const since = startOfMonth();
    const monthLots = lots.filter((l) => l.date >= since);
    if (monthLots.length === 0) {
        // Sentinel for the dispatcher — fall back to LAST_INWARD on all lots.
        return {
            productId: p.id,
            qty: p.stock ?? 0,
            unitCost: 0,
            value: 0,
            method: "MONTHLY_AVG",
            fallback: "no-receipt-history",
        };
    }
    const qty = p.stock ?? 0;
    let totalQty = 0;
    let totalValue = 0;
    for (const lot of monthLots) {
        totalQty   += lot.qty;
        totalValue += lot.qty * lot.rate;
    }
    const unitCost = totalQty > 0 ? totalValue / totalQty : 0;
    return {
        productId: p.id,
        qty,
        unitCost,
        value: qty > 0 ? qty * unitCost : 0,
        method: "MONTHLY_AVG",
    };
}

function startOfMonth(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ── Batch entry point ─────────────────────────────────────────────────────────

export async function valueStockBatch(
    products: ProductMaster[],
    method: ValuationMethod,
): Promise<Map<number, ProductValuation>> {
    const out = new Map<number, ProductValuation>();
    if (products.length === 0) return out;

    const lotsByProduct = await loadInwardLots(products.map((p) => p.id));

    // Track products that need the opening-rate fallback (no lots at all,
    // or MONTHLY_AVG with no month lots that fell back through LAST_INWARD
    // and still produced 0).
    const needsOpeningFallback: ProductMaster[] = [];

    for (const p of products) {
        const lots = lotsByProduct.get(p.id) ?? [];

        // No history at all → fall through to opening-rate, then no-cost-basis.
        if (lots.length === 0) {
            needsOpeningFallback.push(p);
            continue;
        }

        let v: ProductValuation;
        switch (method) {
            case "LAST_INWARD":  v = lastInward(p, lots); break;
            case "WEIGHTED_AVG": v = weightedAvg(p, lots); break;
            case "SIMPLE_AVG":   v = simpleAvg(p, lots); break;
            case "FIFO":         v = fifo(p, lots); break;
            case "MONTHLY_AVG":  v = monthlyAvg(p, lots); break;
        }

        // MONTHLY_AVG with no month lots → degrade to LAST_INWARD over the
        // full lot history (still inside the ledger walk; no extra query).
        if (method === "MONTHLY_AVG" && v.fallback === "no-receipt-history") {
            v = lastInward(p, lots);
            v.method = "MONTHLY_AVG";
            v.fallback = "no-receipt-history";
        }
        out.set(p.id, v);
    }

    if (needsOpeningFallback.length > 0) {
        const openingRates = await loadOpeningRates(needsOpeningFallback.map((p) => p.id));
        for (const p of needsOpeningFallback) {
            const qty = p.stock ?? 0;
            const openingRate = openingRates.get(p.id);
            if (openingRate != null) {
                out.set(p.id, {
                    productId: p.id,
                    qty,
                    unitCost: openingRate,
                    value: qty > 0 ? qty * openingRate : 0,
                    method,
                    fallback: "no-receipt-history",
                });
            } else {
                out.set(p.id, {
                    productId: p.id,
                    qty,
                    unitCost: 0,
                    value: 0,
                    method,
                    fallback: "no-cost-basis",
                });
            }
        }
    }
    return out;
}

// ── Org-wide total ────────────────────────────────────────────────────────────
// Drop-in for the BS closing-stock calculation. Method is selected by the BS
// dropdown (defaults to OrgDefaults.valuationMethod).

export async function valueStockOrgTotal(method: ValuationMethod): Promise<{
    computed:     number;
    productCount: number;
    method:       ValuationMethod;
}> {
    const products = await prisma.invProduct.findMany({
        where: { stock: { not: null } },
        select: { id: true, stock: true },
    });
    const values = await valueStockBatch(products, method);
    let total = 0;
    let count = 0;
    for (const v of values.values()) {
        if (v.value === 0) continue;
        total += v.value;
        count += 1;
    }
    return { computed: total, productCount: count, method };
}
