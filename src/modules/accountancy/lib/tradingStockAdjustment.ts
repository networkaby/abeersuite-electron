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

import { getClosingStockValue } from "./closingStock";

export type TradingStockAdjustment = {
    openingStock: number;
    closingStock: number;
    /** Sign-correct delta to add to a JE-only Net P&L so it matches the trading-aware P&L. */
    adjustment:   number;
};

/**
 * Both ends are valued AS AT their own date — closing as at `to`, opening as at
 * the instant before `from` (closing of the previous day is the opening of this
 * one). Each is an independent dated valuation: quantity replayed from the
 * stock ledger up to that date, priced from the lot history that existed then.
 *
 * This replaced a reverse-walk (`opening = closing − received + issued`) that
 * anchored BOTH figures to today's live stock, so a report for a closed period
 * showed today's stock against that period's sales. Worse, the issued leg
 * summed the outward ledger `rate` — which is the SELLING price, not cost —
 * making `Sales + Closing − Opening` collapse to exactly zero on every period.
 *
 * Deliberately a read-time replay: nothing is stamped at post time and no
 * snapshot table is maintained, so voucher posting (and bulk seeding) is
 * untouched. Rides the existing @@index([productId, date]).
 */
export async function computeTradingStockAdjustment(
    from: Date,
    to:   Date,
): Promise<TradingStockAdjustment> {
    // Opening = value at the close of the day before the period starts.
    // InvStockLedger.date is a DATE column, so 1ms before `from` cleanly
    // excludes `from`'s own day and includes every prior day.
    const openingAsOf = new Date(from.getTime() - 1);

    // First call resolves the org's valuation method; the second reuses it so
    // both ends of the period are valued on the same basis.
    const closing = await getClosingStockValue(undefined, to);
    const opening = await getClosingStockValue(closing.method, openingAsOf);

    return {
        openingStock: opening.computed,
        closingStock: closing.computed,
        adjustment:   closing.computed - opening.computed,
    };
}
