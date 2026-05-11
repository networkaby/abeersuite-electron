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
import { getClosingStockValue } from "./closingStock";

export type TradingStockAdjustment = {
    openingStock: number;
    closingStock: number;
    /** Sign-correct delta to add to a JE-only Net P&L so it matches the trading-aware P&L. */
    adjustment:   number;
};

/**
 * Approximate opening stock by walking back from the live closing-stock
 * valuation: opening = current - net stock IN during the period + net stock
 * OUT during the period. This is the same formula the P&L route uses
 * inline at `src/app/api/accountancy/reports/profit-loss/route.ts`.
 *
 * Returns 0 if the math goes negative (defensive — happens when the
 * InvStockLedger has historical entries we can't reverse-engineer).
 */
export async function computeTradingStockAdjustment(
    from: Date,
    to:   Date,
): Promise<TradingStockAdjustment> {
    const stockNow = await getClosingStockValue();

    const stockMoves = await prisma.invStockLedger.findMany({
        where: { date: { gte: from, lte: to } },
        select: {
            inQty:   true,
            outQty:  true,
            rate:    true,
            product: { select: { costPaise: true } },
        },
    });

    let netInValue  = 0;
    let netOutValue = 0;
    for (const m of stockMoves) {
        const r = Number(m.rate);
        netInValue  += Number(m.inQty)  * r;
        netOutValue += Number(m.outQty) * (m.product.costPaise ? m.product.costPaise / 100 : r);
    }

    const closingStock = stockNow.computed;
    const openingStock = Math.max(0, closingStock - netInValue + netOutValue);

    return {
        openingStock,
        closingStock,
        adjustment: closingStock - openingStock,
    };
}
