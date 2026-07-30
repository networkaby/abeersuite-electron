import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { aggregateRange, loadNormalBalanceMap, netProfitLoss } from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree, type GroupNode } from "@/modules/accountancy/lib/groupTree";
import { getClosingStockValue } from "@/modules/accountancy/lib/closingStock";
import { handleApiError } from "@/shared/lib/api";

// Heavy aggregation: two full-range GL aggregations (period start + end). Give
// Vercel headroom past the default 10s function limit so large datasets don't 504.
export const maxDuration = 60;

// GET /api/accountancy/reports/fund-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
// Sources & application of funds, plus working-capital movement between
// the start and end of the period. Mirrors Tally's MIS Fund Flow.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);

    try {
        const nbMap = await loadNormalBalanceMap();

        // Snapshot balances at start of period (everything before `from`)
        const startBoundary = new Date(from);
        startBoundary.setDate(startBoundary.getDate() - 1);
        startBoundary.setHours(23, 59, 59, 999);

        const [openingAgg, closingAgg, openingStock, closingStock] = await Promise.all([
            aggregateRange(new Date("1970-01-01"), startBoundary, nbMap),
            aggregateRange(new Date("1970-01-01"), to, nbMap),
            // Stock AS AT each boundary — same helper and same as-of semantics the
            // Balance Sheet uses, so the two reports agree by construction.
            getClosingStockValue(undefined, startBoundary),
            getClosingStockValue(undefined, to),
        ]);
        const [openingTree, closingTree] = await Promise.all([
            buildGroupTree(openingAgg),
            buildGroupTree(closingAgg),
        ]);

        const findGroup = (nodes: GroupNode[], name: string): GroupNode | null => {
            for (const n of nodes) {
                if (n.name.toLowerCase() === name.toLowerCase()) return n;
                const f = findGroup(n.children, name);
                if (f) return f;
            }
            return null;
        };
        const closingOf = (tree: GroupNode[], name: string): number =>
            findGroup(tree, name)?.rolledUpClosing ?? 0;

        // Working capital snapshots.
        //
        // Closing Stock is a current asset but is NEVER posted per-voucher to a GL
        // ledger (Tally convention — see bootstrap-seed.ts), so the group tree alone
        // understates Current Assets by the whole stock value. The Balance Sheet
        // already compensates by injecting the unposted remainder as a synthetic
        // ledger under Stock-in-Hand (balance-sheet/route.ts); we do the same
        // arithmetic here so both reports show the same working capital.
        //
        // This also keeps the statement reconciling: `netProfitLoss()` below folds
        // in the trading stock adjustment (closingStock − openingStock), so profit
        // already counts stock movement. Leaving it out of Working Capital made the
        // two sides disagree by exactly that amount, which the "Unexplained
        // (opening-balance drift)" plug then silently absorbed.
        const unpostedStock = (tree: GroupNode[], computed: number) =>
            computed - closingOf(tree, "Stock-in-Hand");

        const wc = (tree: GroupNode[], stockComputed: number) =>
            Math.abs(closingOf(tree, "Current Assets")) + unpostedStock(tree, stockComputed)
            - Math.abs(closingOf(tree, "Current Liabilities"));

        const openingWC = wc(openingTree, openingStock.computed);
        const closingWC = wc(closingTree, closingStock.computed);
        const wcChange  = closingWC - openingWC;

        // Fund-flow movements = period delta on each major non-current group
        const delta = (name: string) =>
            Math.abs(closingOf(closingTree, name)) - Math.abs(closingOf(openingTree, name));

        // Sources of funds = increase in liabilities/capital + decrease in fixed assets + period profit
        // Applications     = increase in fixed assets + decrease in liabilities/capital + drawings
        const capitalChange      = delta("Capital Account");        // + = additional capital
        const loansChange        = delta("Loans (Liability)");      // + = new borrowings
        const fixedAssetsChange  = delta("Fixed Assets");           // + = purchases of FAs (application)
        const investmentsChange  = delta("Investments");            // + = new investments (application)
        const miscExpensesChange = delta("Misc. Expenses (Asset)");
        // Every non-current group on the balance sheet must appear here, or its
        // movement escapes Sources/Applications while still shifting the
        // independently-computed Working Capital change below — the two would
        // silently stop reconciling. Branch/Divisions and Suspense are the two
        // remaining non-current groups besides the five above (see the primary
        // group list in bootstrap-seed.ts).
        const branchDivisionsChange = delta("Branch / Divisions");
        const suspenseChange        = delta("Suspense A/c");

        // Period net profit — the SAME helper the Balance Sheet uses for its
        // Equity line (aggregateLedger.ts netProfitLoss()), which folds in the
        // trading stock adjustment. Deriving profit here instead from raw
        // Sales/Purchase/Direct/Indirect GL deltas (as this route used to)
        // ignores that stock movement entirely — Stock-in-Hand is never
        // posted to GL (see bootstrap-seed.ts), so every purchase would hit
        // expense immediately with nothing netted back out for unsold stock,
        // producing a profit figure that silently disagreed with the real P&L.
        const periodProfit = await netProfitLoss(from, to);

        const sources: { label: string; amount: number }[] = [];
        const applications: { label: string; amount: number }[] = [];

        if (periodProfit > 0)        sources.push({ label: "Net Profit",                amount: periodProfit });
        else if (periodProfit < 0)   applications.push({ label: "Net Loss",             amount: -periodProfit });

        if (capitalChange > 0)       sources.push({ label: "Increase in Capital",       amount: capitalChange });
        else if (capitalChange < 0)  applications.push({ label: "Decrease in Capital / Drawings", amount: -capitalChange });

        if (loansChange > 0)         sources.push({ label: "New Loans",                 amount: loansChange });
        else if (loansChange < 0)    applications.push({ label: "Loan Repayment",       amount: -loansChange });

        if (fixedAssetsChange > 0)   applications.push({ label: "Purchase of Fixed Assets", amount: fixedAssetsChange });
        else if (fixedAssetsChange < 0) sources.push({ label: "Sale of Fixed Assets",      amount: -fixedAssetsChange });

        if (investmentsChange > 0)   applications.push({ label: "New Investments",      amount: investmentsChange });
        else if (investmentsChange < 0) sources.push({ label: "Sale of Investments",    amount: -investmentsChange });

        if (miscExpensesChange > 0)  applications.push({ label: "Misc. Expenses (deferred)", amount: miscExpensesChange });

        if (branchDivisionsChange > 0) applications.push({ label: "Increase in Branch / Divisions", amount: branchDivisionsChange });
        else if (branchDivisionsChange < 0) sources.push({ label: "Decrease in Branch / Divisions", amount: -branchDivisionsChange });

        if (suspenseChange > 0)      applications.push({ label: "Increase in Suspense A/c", amount: suspenseChange });
        else if (suspenseChange < 0) sources.push({ label: "Decrease in Suspense A/c", amount: -suspenseChange });

        // Reconciling plug — mirrors the Balance Sheet's own "Difference in
        // opening balances" line (balance-sheet/page.tsx). The named lines
        // above should account for the entire Working Capital movement; if
        // they don't, it's because some ledger's opening/entry doesn't have a
        // clean double-entry counterpart (the same root cause the Balance
        // Sheet already has to plug). Surfacing it here keeps the statement
        // honest instead of silently failing to reconcile.
        const explained = sources.reduce((s, r) => s + r.amount, 0) - applications.reduce((s, r) => s + r.amount, 0);
        const residual = wcChange - explained;
        if (residual > 0.005)       sources.push({ label: "Unexplained (opening-balance drift)", amount: residual });
        else if (residual < -0.005) applications.push({ label: "Unexplained (opening-balance drift)", amount: -residual });

        const totalSources      = sources.reduce((s, r) => s + r.amount, 0);
        const totalApplications = applications.reduce((s, r) => s + r.amount, 0);

        return NextResponse.json({
            from: from.toISOString(),
            to:   to.toISOString(),
            sources, applications,
            totalSources, totalApplications,
            workingCapital: { opening: openingWC, closing: closingWC, change: wcChange },
            // Diagnostics: the stock folded into each Working Capital snapshot above.
            closingStock: {
                opening: openingStock.computed,
                closing: closingStock.computed,
                method:  closingStock.method,
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to compute fund flow");
    }
}
