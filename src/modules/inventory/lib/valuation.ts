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
    /**
     * ₹ — qty × unitCost. NEGATIVE when stock is negative (Tally convention:
     * goods sold before their purchase was entered carry a negative value, so
     * `COGS = Opening + Purchases − Closing` stays true). 0 only when qty is 0
     * or no cost basis exists.
     */
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
 *
 * `asOf` caps the lot history at a date, so a report for a closed period prices
 * stock from the purchase history that existed THEN, not from purchases that
 * landed afterwards. Omit for the live (up-to-now) valuation.
 */
async function loadInwardLots(productIds: number[], asOf?: Date): Promise<Map<number, Lot[]>> {
    if (productIds.length === 0) return new Map();

    const [rows, masters] = await Promise.all([
        prisma.invStockLedger.findMany({
            where:   {
                productId: { in: productIds },
                inQty:     { gt: 0 },
                ...(asOf ? { date: { lte: asOf } } : {}),
                universalVoucher:   { status: "POSTED", deletedAt: null },
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
        // Undated opening (the norm — openingStockDate is null on every product
        // today) counts from the beginning of time, so it survives any `asOf`.
        const openingDate = m.openingStockDate ?? new Date(0);
        if (asOf && openingDate > asOf) continue;
        const openingLot: Lot = {
            date: openingDate,
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

// Tally convention: NEGATIVE stock is valued NEGATIVELY, not clamped to zero.
// Goods sold before their purchase is entered (stock arrives in January, the
// bill lands in February) leave a negative balance. Valuing that at ₹0 would
// silently overstate gross profit for the whole window between the sale and
// the late purchase entry — `COGS = Opening + Purchases − Closing` only holds
// if a negative closing carries its real negative value.
const valueOf = (qty: number, unitCost: number) => qty * unitCost;

function lastInward(p: ProductMaster, lots: Lot[]): ProductValuation {
    const qty = p.stock ?? 0;
    const unitCost = lots[lots.length - 1].rate;
    return {
        productId: p.id,
        qty,
        unitCost,
        value: valueOf(qty, unitCost),
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
        value: valueOf(qty, unitCost),
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
        value: valueOf(qty, unitCost),
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
    if (qty === 0) {
        return { productId: p.id, qty, unitCost: 0, value: 0, method: "FIFO" };
    }
    if (qty < 0) {
        // Oversold — there are no surviving lots to walk, so the shortfall is
        // carried at the most recent inward rate (what the replacement costs).
        const unitCost = lots[lots.length - 1].rate;
        return { productId: p.id, qty, unitCost, value: valueOf(qty, unitCost), method: "FIFO" };
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

// MONTHLY_AVG — weighted average of the most recent month that had any
// inward lots. Walk backwards through `lots` (sorted oldest-first) to find
// the latest (year, month) with at least one entry, then WA over just that
// month's lots. Carries forward across quiet months without dragging in
// older single events. Falls through to opening-rate via the dispatcher
// when no inward history exists at all.
function monthlyAvg(p: ProductMaster, lots: Lot[]): ProductValuation {
    let bestKey: string | null = null;
    const bestMonthLots: Lot[] = [];
    for (let i = lots.length - 1; i >= 0; i -= 1) {
        const lot = lots[i];
        const key = `${lot.date.getFullYear()}-${lot.date.getMonth()}`;
        if (bestKey === null) {
            bestKey = key;
            bestMonthLots.push(lot);
            continue;
        }
        if (key === bestKey) {
            bestMonthLots.push(lot);
        } else {
            break;  // older month — we've collected the full latest month
        }
    }
    if (bestMonthLots.length === 0) {
        // Sentinel for the dispatcher — fall back to opening-rate path.
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
    for (const lot of bestMonthLots) {
        totalQty   += lot.qty;
        totalValue += lot.qty * lot.rate;
    }
    const unitCost = totalQty > 0 ? totalValue / totalQty : 0;
    return {
        productId: p.id,
        qty,
        unitCost,
        value: valueOf(qty, unitCost),
        method: "MONTHLY_AVG",
    };
}

// ── Batch entry point ─────────────────────────────────────────────────────────

export async function valueStockBatch(
    products: ProductMaster[],
    method: ValuationMethod,
    asOf?: Date,
): Promise<Map<number, ProductValuation>> {
    const out = new Map<number, ProductValuation>();
    if (products.length === 0) return out;

    const lotsByProduct = await loadInwardLots(products.map((p) => p.id), asOf);

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
        // monthlyAvg() carries forward to the latest month with lots; only
        // returns `no-receipt-history` when lots is empty (impossible here
        // — we already filtered above), but kept as a defensive passthrough.
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
                    value: valueOf(qty, openingRate),
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

// ── Last-inward cost helper (PR 4) ───────────────────────────────────────────
// Convenience wrapper used by API routes that surface a `lastPurchasePaise`
// field — combobox, product transactions, master GET. Same code path as
// `valueStockBatch(., "LAST_INWARD")`; returns paise (Int) instead of rupees,
// and skips the per-product `{ unitCost, value, ... }` envelope.

export async function loadLastInwardCostMap(
    products: ProductMaster[],
): Promise<Map<number, number | null>> {
    const out = new Map<number, number | null>();
    if (products.length === 0) return out;
    const valuations = await valueStockBatch(products, "LAST_INWARD");
    for (const p of products) {
        const v = valuations.get(p.id);
        out.set(p.id, v && v.unitCost > 0 ? Math.round(v.unitCost * 100) : null);
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

// ── As-at-a-date org total (time-travel) ──────────────────────────────────────
//
// `valueStockOrgTotal` above reads the LIVE `InvProduct.stock` cache, so it can
// only ever answer "what is stock worth right now". Reports for a closed period
// (P&L Opening/Closing Stock, a back-dated Balance Sheet) need "what was stock
// worth ON that date" — both halves dated:
//
//   qty  as-at = openingStock master + Σ(inQty − outQty) for rows dated ≤ asOf
//   cost as-at = the lot walk, capped at asOf (see loadInwardLots)
//
// Deliberately a READ-TIME replay: no snapshot table, no per-voucher stamping,
// nothing added to the posting path — so seeding purchases/sales is unaffected.
// It rides the existing @@index([productId, date]) on InvStockLedger.
//
// The live cache stays the fast path for everything current (POS scan,
// available-to-sell, reorder). This is only for dated questions.
export async function valueStockOrgTotalAsOf(
    asOf: Date,
    method: ValuationMethod,
): Promise<{
    computed:     number;
    productCount: number;
    method:       ValuationMethod;
}> {
    const [masters, moves] = await Promise.all([
        prisma.invProduct.findMany({
            where:  { stock: { not: null } },   // null = stock not tracked
            select: { id: true, openingStock: true },
        }),
        prisma.invStockLedger.groupBy({
            by:    ["productId"],
            where: {
                date: { lte: asOf },
                universalVoucher: { status: "POSTED", deletedAt: null },
            },
            _sum:  { inQty: true, outQty: true },
        }),
    ]);

    const movementByProduct = new Map<number, number>();
    for (const m of moves) {
        movementByProduct.set(m.productId, toNumber(m._sum.inQty ?? 0) - toNumber(m._sum.outQty ?? 0));
    }

    // Same formula recomputeProductStock uses for "now", just date-capped:
    // openingStock is a master column, NOT a ledger row, so it is folded in
    // separately (exactly as GL folds Account.openingBalance into its closing).
    const products: ProductMaster[] = masters.map((m) => ({
        id:    m.id,
        stock: toNumber(m.openingStock ?? 0) + (movementByProduct.get(m.id) ?? 0),
    }));

    const values = await valueStockBatch(products, method, asOf);
    let total = 0;
    let count = 0;
    for (const v of values.values()) {
        if (v.value === 0) continue;
        total += v.value;
        count += 1;
    }
    return { computed: total, productCount: count, method };
}
