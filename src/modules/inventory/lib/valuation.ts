// Pluggable stock valuation strategies.
//
// `InvProduct.stock` and `costPaise` give a fast "last purchase cost" snapshot,
// but real businesses need WA / FIFO / LIFO for trading P&L. This module is the
// single entry point for any caller that needs per-product or org-wide stock
// values. Consumers pick a method, we compute. Per-product math used to live in
// `stockValue.ts#productClosingValue` — that helper still exists for the cached
// LAST_COST case; this lib wraps it and adds ledger-walked strategies.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { productClosingValue } from "@/modules/inventory/lib/stockValue";
import { toNumber } from "@/modules/accountancy/lib/balance";

export type ValuationMethod = "LAST_COST" | "WEIGHTED_AVG" | "FIFO" | "LIFO";

export const VALUATION_METHODS: ValuationMethod[] = [
    "LAST_COST",
    "WEIGHTED_AVG",
    "FIFO",
    "LIFO",
];

export interface ProductValuation {
    productId: number;
    qty: number;
    /** ₹ per unit, method-dependent. 0 when cost basis unknown. */
    unitCost: number;
    /** ₹ — qty × unitCost. 0 when qty ≤ 0. */
    value: number;
    method: ValuationMethod;
    fallback?: "no-receipt-history" | "no-cost-basis" | "not-implemented";
}

export interface ProductMaster {
    id: number;
    stock: number | null;
    costPaise: number | null;
}

// ── LAST_COST ──────────────────────────────────────────────────────────────────
// Cached last-purchase cost: unitCost = costPaise / 100. Matches the legacy
// `productClosingValue()` exactly so Balance Sheet stays bit-identical.

function lastCost(p: ProductMaster): ProductValuation {
    const qty = p.stock ?? 0;
    const value = productClosingValue(p);
    const unitCost = p.costPaise != null ? p.costPaise / 100 : 0;
    return {
        productId: p.id,
        qty,
        unitCost,
        value,
        method: "LAST_COST",
        ...(p.costPaise == null ? { fallback: "no-cost-basis" as const } : {}),
    };
}

// ── Ledger-walked strategies ──────────────────────────────────────────────────
// All three (WA / FIFO / LIFO) walk POSTED inward entries (inQty > 0) ordered
// by date+id. We fetch all rows for the given productIds in one query and group
// in memory.

type Lot = { date: Date; id: number; qty: number; rate: number };

async function loadInwardLots(productIds: number[]): Promise<Map<number, Lot[]>> {
    if (productIds.length === 0) return new Map();
    const rows = await prisma.invStockLedger.findMany({
        where:   {
            productId: { in: productIds },
            inQty:     { gt: 0 },
            voucher:   { status: "POSTED", deletedAt: null },
        },
        select:  { id: true, productId: true, date: true, inQty: true, rate: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
    });
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
    return map;
}

function weightedAvg(p: ProductMaster, lots: Lot[]): ProductValuation {
    const qty = p.stock ?? 0;
    if (lots.length === 0) {
        const fb = lastCost(p);
        return { ...fb, method: "WEIGHTED_AVG", fallback: "no-receipt-history" };
    }
    let totalQty = 0;
    let totalValue = 0;
    for (const lot of lots) {
        totalQty   += lot.qty;
        totalValue += lot.qty * lot.rate;
    }
    const unitCost = totalQty > 0 ? totalValue / totalQty : 0;
    const value = qty > 0 ? qty * unitCost : 0;
    return { productId: p.id, qty, unitCost, value, method: "WEIGHTED_AVG" };
}

// FIFO: oldest receipts consumed first by sales. Remaining on-hand qty is
// priced at the most-recent surviving lots. We don't replay each sale —
// instead we treat "remaining qty = current stock" and walk lots in REVERSE
// chronological order, filling qty from the most recent lots backward.
// This produces the same surviving-lot composition as a full FIFO replay
// against perfectly matched inward/outward totals.
function fifo(p: ProductMaster, lots: Lot[]): ProductValuation {
    const qty = p.stock ?? 0;
    if (lots.length === 0) {
        const fb = lastCost(p);
        return { ...fb, method: "FIFO", fallback: "no-receipt-history" };
    }
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

// LIFO scaffold — same shape as FIFO but consumes newest-first. Surviving lots
// after such a replay would be the OLDEST inward entries. We approximate by
// walking lots oldest-first and filling qty until exhausted.
function lifo(p: ProductMaster, lots: Lot[]): ProductValuation {
    const qty = p.stock ?? 0;
    if (lots.length === 0) {
        const fb = lastCost(p);
        return { ...fb, method: "LIFO", fallback: "no-receipt-history" };
    }
    if (qty <= 0) {
        return { productId: p.id, qty, unitCost: 0, value: 0, method: "LIFO" };
    }
    let remaining = qty;
    let accValue = 0;
    for (let i = 0; i < lots.length && remaining > 0; i += 1) {
        const lot = lots[i];
        const take = Math.min(remaining, lot.qty);
        accValue  += take * lot.rate;
        remaining -= take;
    }
    if (remaining > 0) {
        accValue += remaining * lots[lots.length - 1].rate;
    }
    const unitCost = qty > 0 ? accValue / qty : 0;
    return { productId: p.id, qty, unitCost, value: accValue, method: "LIFO" };
}

// ── Batch entry point ─────────────────────────────────────────────────────────

export async function valueStockBatch(
    products: ProductMaster[],
    method: ValuationMethod,
): Promise<Map<number, ProductValuation>> {
    const out = new Map<number, ProductValuation>();

    if (method === "LAST_COST" || products.length === 0) {
        for (const p of products) out.set(p.id, lastCost(p));
        if (method !== "LAST_COST") {
            // products array empty — still nothing to value; harmless
        }
        return out;
    }

    const lotsByProduct = await loadInwardLots(products.map((p) => p.id));
    for (const p of products) {
        const lots = lotsByProduct.get(p.id) ?? [];
        let v: ProductValuation;
        if (method === "WEIGHTED_AVG")     v = weightedAvg(p, lots);
        else if (method === "FIFO")        v = fifo(p, lots);
        else /* method === "LIFO" */       v = lifo(p, lots);
        out.set(p.id, v);
    }
    return out;
}

// ── Org-wide total ────────────────────────────────────────────────────────────
// Drop-in replacement for `getClosingStockValue()` that supports any method.
// Callers wanting the legacy behavior pass "LAST_COST" (or use the existing
// `getClosingStockValue` wrapper, which is kept for back-compat).

export async function valueStockOrgTotal(method: ValuationMethod): Promise<{
    computed:     number;
    productCount: number;
    method:       ValuationMethod;
}> {
    const products = await prisma.invProduct.findMany({
        where: { stock: { not: null } },
        select: { id: true, stock: true, costPaise: true },
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
