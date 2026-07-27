import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { aggregateRange, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree } from "@/modules/accountancy/lib/groupTree";
import { computeTradingStockAdjustment } from "@/modules/accountancy/lib/tradingStockAdjustment";
import { handleApiError } from "@/shared/lib/api";

// Heavy aggregation: full-range GL groupBy + whole-inventory stock valuation.
// Give Vercel headroom past the default 10s function limit so large datasets
// don't 504.
export const maxDuration = 60;

// GET /api/accountancy/reports/profit-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);

    try {
        const nbMap   = await loadNormalBalanceMap();
        const aggMap  = await aggregateRange(from, to, nbMap);

        // Get full tree (we'll segment by primary group name)
        const tree = await buildGroupTree(aggMap, { types: ["INCOME", "EXPENSE"] });

        // Helper: find a primary group node by name (case-insensitive)
        const findPrimary = (name: string) => tree.find(
            (n) => n.name.toLowerCase() === name.toLowerCase(),
        );

        const salesAccounts    = findPrimary("Sales Accounts");
        const purchaseAccounts = findPrimary("Purchase Accounts");
        const directIncomes    = findPrimary("Direct Incomes");
        const directExpenses   = findPrimary("Direct Expenses");
        const indirectIncomes  = findPrimary("Indirect Incomes");
        const indirectExpenses = findPrimary("Indirect Expenses");

        // Trading-account stock adjustment — shared with netProfitLoss() so
        // the Balance Sheet's Equity reconciles with the P&L's net profit.
        const { openingStock, closingStock } = await computeTradingStockAdjustment(from, to);

        // ── Row totals from rolled-up tree ──────────────────────────────
        //
        // A P&L reports the PERIOD's activity, so this nets the period's
        // debits and credits — NOT `rolledUpClosing`, which is
        // `opening + period` and therefore carries every earlier transaction
        // into the window. Using closing made the report correct only when
        // `from` was the start of the books: pick any later start (a single
        // day, a month) and it silently showed cumulative-to-date figures
        // instead of that period's.
        //
        // Income is credit-natured, expense debit-natured; abs() keeps every
        // row positive for display, exactly as before.
        const sumRoot = (n?: { rolledUpDebits: number; rolledUpCredits: number; type: string }) => {
            if (!n) return 0;
            const period = n.type === "INCOME"
                ? n.rolledUpCredits - n.rolledUpDebits
                : n.rolledUpDebits - n.rolledUpCredits;
            return Math.abs(period);
        };

        const trading = {
            debit: {
                openingStock,
                purchaseAccounts: sumRoot(purchaseAccounts),
                directExpenses:   sumRoot(directExpenses),
            },
            credit: {
                salesAccounts:    sumRoot(salesAccounts),
                directIncomes:    sumRoot(directIncomes),
                closingStock,
            },
        };

        const tradingDr = trading.debit.openingStock + trading.debit.purchaseAccounts + trading.debit.directExpenses;
        const tradingCr = trading.credit.salesAccounts + trading.credit.directIncomes + trading.credit.closingStock;
        const grossProfit = tradingCr - tradingDr;

        const pnl = {
            debit: {
                indirectExpenses: sumRoot(indirectExpenses),
                grossLossBrought: grossProfit < 0 ? Math.abs(grossProfit) : 0,
            },
            credit: {
                indirectIncomes:    sumRoot(indirectIncomes),
                grossProfitBrought: grossProfit > 0 ? grossProfit : 0,
            },
        };

        const pnlDr = pnl.debit.indirectExpenses + pnl.debit.grossLossBrought;
        const pnlCr = pnl.credit.indirectIncomes + pnl.credit.grossProfitBrought;
        const netProfit = pnlCr - pnlDr;

        return NextResponse.json({
            from: from.toISOString(),
            to:   to.toISOString(),
            trees: {
                salesAccounts, purchaseAccounts, directIncomes, directExpenses,
                indirectIncomes, indirectExpenses,
            },
            trading,
            pnl,
            grossProfit,
            netProfit,
        });
    } catch (e) {
        return handleApiError(e, "Failed to generate P&L");
    }
}
