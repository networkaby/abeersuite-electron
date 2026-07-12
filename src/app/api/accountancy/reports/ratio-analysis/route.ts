import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { aggregateRange, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree, type GroupNode } from "@/modules/accountancy/lib/groupTree";
import { getClosingStockValue } from "@/modules/accountancy/lib/closingStock";
import { handleApiError } from "@/shared/lib/api";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

// GET /api/accountancy/reports/ratio-analysis?asOf=YYYY-MM-DD
// Period: Indian fiscal year start (1-Apr) → asOf.
// Returns Tally's "Principal Groups" and "Principal Ratios" panels.
export async function GET(req: Request) {
    const { response } = await requireModuleAccess("accountancy");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get("asOf");
    const asOf = asOfParam ? new Date(asOfParam) : new Date();
    asOf.setHours(23, 59, 59, 999);
    const fyYear = asOf.getMonth() < 3 ? asOf.getFullYear() - 1 : asOf.getFullYear();
    const from = new Date(fyYear, 3, 1, 0, 0, 0, 0);

    try {
        const nbMap  = await loadNormalBalanceMap();
        const aggMap = await aggregateRange(from, asOf, nbMap);
        const tree   = await buildGroupTree(aggMap);

        const findGroup = (nodes: GroupNode[], name: string): GroupNode | null => {
            for (const n of nodes) {
                if (n.name.toLowerCase() === name.toLowerCase()) return n;
                const f = findGroup(n.children, name);
                if (f) return f;
            }
            return null;
        };
        const abs = (n: GroupNode | null): number =>
            n ? Math.abs(n.rolledUpClosing) : 0;

        const cashInHand         = abs(findGroup(tree, "Cash-in-Hand"));
        const bankAccounts       = abs(findGroup(tree, "Bank Accounts"));
        const bankOd             = abs(findGroup(tree, "Bank OD A/c"));
        const sundryDebtors      = abs(findGroup(tree, ACCOUNT_GROUPS.SUNDRY_DEBTORS));
        const sundryCreditors    = abs(findGroup(tree, ACCOUNT_GROUPS.SUNDRY_CREDITORS));
        const sales              = abs(findGroup(tree, "Sales Accounts"));
        const purchases          = abs(findGroup(tree, "Purchase Accounts"));
        const stockGroupValue    = abs(findGroup(tree, "Stock-in-Hand"));
        const capitalAccount     = abs(findGroup(tree, "Capital Account"));
        const loansLiability     = abs(findGroup(tree, "Loans (Liability)"));
        const currentAssets      = abs(findGroup(tree, "Current Assets"));
        const currentLiabilities = abs(findGroup(tree, "Current Liabilities"));
        const directExpenses     = abs(findGroup(tree, "Direct Expenses"));
        const indirectExpenses   = abs(findGroup(tree, "Indirect Expenses"));
        const directIncomes      = abs(findGroup(tree, "Direct Incomes"));
        const indirectIncomes    = abs(findGroup(tree, "Indirect Incomes"));

        // Inventory module's live valuation is more reliable than the GL stock
        // group balance (which only updates on stock-journal vouchers).
        const stockLive = await getClosingStockValue();
        const stockInHand = stockLive.computed > 0 ? stockLive.computed : stockGroupValue;

        // P&L summary (same shape as profit-loss API but condensed)
        const grossProfit = (sales + directIncomes) - (purchases + directExpenses);
        const netProfit   = grossProfit + indirectIncomes - indirectExpenses;

        // Working capital + turnover
        const workingCapital = currentAssets - currentLiabilities;
        const wkgCapTurnover = workingCapital > 0 ? sales / workingCapital : null;
        const inventoryTurnover = stockInHand > 0 ? sales / stockInHand : null;

        // Ratios
        const safeDiv = (a: number, b: number): number | null => (b > 0 ? a / b : null);
        const equityBase = capitalAccount + netProfit;
        const periodDays = Math.max(1, Math.ceil((asOf.getTime() - from.getTime()) / 86_400_000));

        const currentRatio   = safeDiv(currentAssets, currentLiabilities);
        const quickRatio     = safeDiv(currentAssets - stockInHand, currentLiabilities);
        const debtEquity     = safeDiv(loansLiability, equityBase);
        const grossProfitPct = sales > 0 ? (grossProfit / sales) * 100 : null;
        const netProfitPct   = sales > 0 ? (netProfit   / sales) * 100 : null;
        const opCostPct      = sales > 0 ? ((directExpenses + indirectExpenses) / sales) * 100 : null;
        const dailySales     = sales / periodDays;
        const recvDays       = dailySales > 0 ? sundryDebtors / dailySales : null;
        const roiPct         = equityBase > 0 ? (netProfit / equityBase) * 100 : null;
        const returnOnWcPct  = workingCapital > 0 ? (netProfit / workingCapital) * 100 : null;

        return NextResponse.json({
            from: from.toISOString(),
            to:   asOf.toISOString(),
            principalGroups: {
                workingCapital, cashInHand, bankAccounts, bankOd,
                sundryDebtors, sundryCreditors, sales, purchases,
                stockInHand, netProfit, wkgCapTurnover, inventoryTurnover,
            },
            ratios: {
                currentRatio, quickRatio, debtEquity,
                grossProfitPct, netProfitPct, opCostPct,
                recvDays, roiPct, returnOnWcPct,
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to compute ratio analysis");
    }
}
