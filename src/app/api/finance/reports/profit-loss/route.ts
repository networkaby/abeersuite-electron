import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { aggregateRange, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree } from "@/modules/accountancy/lib/groupTree";
import { computeTradingStockAdjustment } from "@/modules/accountancy/lib/tradingStockAdjustment";

// GET /api/finance/reports/profit-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request) {
    const { response } = await requirePermission("accountancy:view:org");
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
        const sumRoot = (n?: { rolledUpClosing: number }) => n ? Math.abs(n.rolledUpClosing) : 0;

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
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to generate P&L" }, { status: 500 });
    }
}
