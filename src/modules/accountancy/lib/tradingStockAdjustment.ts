// Tally-style trading-account stock adjustment for a given period.
//
// In a trading P&L, the gross-profit calculation is:
//   Cr side: Sales + Closing Stock + Direct Incomes
//   Dr side: Opening Stock + Purchases + Direct Expenses
//
// "Opening Stock" and "Closing Stock" are valuations, not journal lines —
// so a JournalLine-only sum (like netProfitLoss did before) misses them
// and the Balance Sheet's Equity total drifts away from the P&L.
//
// This helper returns both values so anyone needing "trading stock impact
// on net profit" can do `closingStock - openingStock`.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { loadUnitCostMap, resolveCostMethod } from "@/modules/inventory/lib/costBasis";
import { getClosingStockValue } from "./closingStock";

export type TradingStockAdjustment = {
    openingStock: number;
    closingStock: number;
    /** Sign-correct delta to add to a JE-only Net P&L so it matches the trading-aware P&L. */
    adjustment:   number;
};

/**
 * Approximate opening stock by walking back from the live closing-stock
 * valuation:
 *
 *   opening = closing − (goods received at cost) + (goods issued at cost)
 *
 * BOTH ends of that walk must be on the SAME basis as the closing valuation,
 * which is cost (`valuation.ts` walks inward lots only). Inward ledger rows
 * already carry cost in `rate`, but OUTWARD rows carry the SELLING rate — the
 * POS/sale posters stamp `line.unitPrice`. Summing outward `rate` therefore
 * made opening = closing + sales value, which forced
 * `Sales + Closing − Opening` to exactly zero on every period. So the issued
 * side is priced from the shared derived cost basis instead — the same map
 * the Bill-wise Profit report uses, so the two reports agree by construction.
 *
 * Returns 0 if the math goes negative (defensive — happens when the
 * InvStockLedger has historical entries we can't reverse-engineer).
 *
 * Known limitation: `closing` is the LIVE valuation, not an as-at-`to`
 * valuation, so a report for a closed past period still starts from today's
 * stock. A true as-of walk needs a dated quantity replay (InvProduct.stock is
 * a live cache) — parked, tracked in PROJECT_BRAIN.
 */
export async function computeTradingStockAdjustment(
    from: Date,
    to:   Date,
): Promise<TradingStockAdjustment> {
    const stockNow = await getClosingStockValue();
    // Same method that valued `closing`, so both ends of the walk agree.
    // (FIFO / MONTHLY_AVG degrade to WEIGHTED_AVG for the issued side — a
    // per-unit FIFO replay isn't worth it here, same trade-off as BI.)
    const costMethod = resolveCostMethod(stockNow.method);

    // POSTED / non-deleted only — matches valuation.ts and the GL aggregates.
    const periodWhere = {
        date: { gte: from, lte: to },
        universalVoucher: { status: "POSTED" as const, deletedAt: null },
    };

    const [inRows, outSums] = await Promise.all([
        prisma.invStockLedger.findMany({
            where:  { ...periodWhere, inQty: { gt: 0 } },
            select: { inQty: true, rate: true },
        }),
        prisma.invStockLedger.groupBy({
            by:    ["productId"],
            where: { ...periodWhere, outQty: { gt: 0 } },
            _sum:  { outQty: true },
        }),
    ]);

    // Goods received: inward `rate` IS the cost basis.
    let receivedAtCost = 0;
    for (const r of inRows) receivedAtCost += toNumber(r.inQty) * toNumber(r.rate);

    // Goods issued: priced from the derived cost basis, never the row rate.
    const costMap = await loadUnitCostMap(outSums.map((s) => s.productId), to, costMethod);
    let issuedAtCost = 0;
    for (const s of outSums) {
        issuedAtCost += toNumber(s._sum.outQty ?? 0) * (costMap.get(s.productId)?.unitCost ?? 0);
    }

    const closingStock = stockNow.computed;
    const openingStock = Math.max(0, closingStock - receivedAtCost + issuedAtCost);

    return {
        openingStock,
        closingStock,
        adjustment: closingStock - openingStock,
    };
}
