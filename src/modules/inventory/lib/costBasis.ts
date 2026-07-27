// Derived unit cost per product — the single cost basis for every report that
// needs "what did these goods cost us".
//
// COGS is NOT stored at sale time (VoucherInventoryLine has no costAtSale
// column, and outward InvStockLedger rows carry the SELLING rate). Unit cost is
// therefore reconstructed at report time from inward InvStockLedger lots capped
// at a period end — same lot semantics as `valuation.ts`, but date-capped so
// old-period reports use only the purchase history that existed up to then.
//
// FIFO / MONTHLY_AVG org defaults fall back to WEIGHTED_AVG here: a true
// per-sold-unit FIFO needs a full in/out replay that isn't worth it for
// decision reports. Callers echo the method actually used to the UI.
//
// Lives in the inventory module (next to valuation.ts) because both BI margin
// reports and the accountancy trading account import it — one implementation,
// so P&L gross profit and Bill-wise Profit agree by construction.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";

export type CostMethod = "LAST_INWARD" | "WEIGHTED_AVG" | "SIMPLE_AVG";

export type CostFallback = "opening-rate" | "no-cost-basis";

export type UnitCost = { unitCost: number; fallback?: CostFallback };

/** Org valuation method → the COGS method this cost basis supports. */
export function resolveCostMethod(method: string | null | undefined): CostMethod {
    return method === "LAST_INWARD" || method === "SIMPLE_AVG" ? method : "WEIGHTED_AVG";
}

/**
 * Per-product unit cost from inward lots dated ≤ `asOf` (POSTED, non-deleted
 * vouchers) + the product's opening lot. Cost basis is org-wide on purpose —
 * purchases may land at any branch, but the goods sold are the same goods.
 * Fallback: no lots → openingRate → 0 (flagged no-cost-basis).
 */
export async function loadUnitCostMap(
    productIds: number[],
    asOf: Date,
    method: CostMethod,
): Promise<Map<number, UnitCost>> {
    const out = new Map<number, UnitCost>();
    if (productIds.length === 0) return out;

    const [rows, masters] = await Promise.all([
        prisma.invStockLedger.findMany({
            where: {
                productId: { in: productIds },
                inQty: { gt: 0 },
                date: { lte: asOf },
                universalVoucher: { status: "POSTED", deletedAt: null },
            },
            select: { productId: true, date: true, inQty: true, rate: true },
            orderBy: [{ date: "asc" }, { id: "asc" }],
        }),
        prisma.invProduct.findMany({
            where: { id: { in: productIds } },
            select: { id: true, openingStock: true, openingRate: true, openingStockDate: true },
        }),
    ]);

    type Lot = { qty: number; rate: number };
    const lotsByProduct = new Map<number, Lot[]>();
    const pushLot = (productId: number, lot: Lot) => {
        const arr = lotsByProduct.get(productId);
        if (arr) arr.push(lot); else lotsByProduct.set(productId, [lot]);
    };

    // Opening lot first (it predates every ledger row), then ledger lots in date order.
    const openingRateById = new Map<number, number>();
    for (const m of masters) {
        const openQty = m.openingStock != null ? toNumber(m.openingStock) : 0;
        const openRate = m.openingRate != null ? toNumber(m.openingRate) : 0;
        if (openRate > 0) openingRateById.set(m.id, openRate);
        const inRange = !m.openingStockDate || m.openingStockDate <= asOf;
        if (openQty > 0 && openRate > 0 && inRange) pushLot(m.id, { qty: openQty, rate: openRate });
    }
    for (const r of rows) pushLot(r.productId, { qty: toNumber(r.inQty), rate: toNumber(r.rate) });

    for (const id of productIds) {
        const lots = lotsByProduct.get(id);
        if (!lots || lots.length === 0) {
            const openRate = openingRateById.get(id);
            out.set(id, openRate
                ? { unitCost: openRate, fallback: "opening-rate" }
                : { unitCost: 0, fallback: "no-cost-basis" });
            continue;
        }
        let unitCost = 0;
        switch (method) {
            case "LAST_INWARD":
                unitCost = lots[lots.length - 1].rate;
                break;
            case "SIMPLE_AVG":
                unitCost = lots.reduce((s, l) => s + l.rate, 0) / lots.length;
                break;
            case "WEIGHTED_AVG": {
                let q = 0, v = 0;
                for (const l of lots) { q += l.qty; v += l.qty * l.rate; }
                unitCost = q > 0 ? v / q : 0;
                break;
            }
        }
        out.set(id, { unitCost });
    }
    return out;
}
