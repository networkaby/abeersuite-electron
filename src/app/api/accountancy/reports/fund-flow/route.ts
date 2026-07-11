import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { aggregateRange, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree, type GroupNode } from "@/modules/accountancy/lib/groupTree";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// Heavy aggregation: two full-range GL aggregations (period start + end). Give
// Vercel headroom past the default 10s function limit so large datasets don't 504.
export const maxDuration = 60;

// GET /api/accountancy/reports/fund-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
// Sources & application of funds, plus working-capital movement between
// the start and end of the period. Mirrors Tally's MIS Fund Flow.
export async function GET(req: Request) {
    const { response } = await requireModuleAccess("accountancy", PERMISSIONS.ACCOUNTANCY_VIEW);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);

    try {
        const nbMap = await loadNormalBalanceMap();

        // Snapshot balances at start of period (everything before `from`)
        const startBoundary = new Date(from);
        startBoundary.setDate(startBoundary.getDate() - 1);
        startBoundary.setHours(23, 59, 59, 999);

        const [openingAgg, closingAgg] = await Promise.all([
            aggregateRange(new Date("1970-01-01"), startBoundary, nbMap),
            aggregateRange(new Date("1970-01-01"), to, nbMap),
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

        // Working capital snapshots
        const wc = (tree: GroupNode[]) =>
            Math.abs(closingOf(tree, "Current Assets")) - Math.abs(closingOf(tree, "Current Liabilities"));

        const openingWC = wc(openingTree);
        const closingWC = wc(closingTree);
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

        // Period net profit — derived from income/expense closing values
        // (simpler than re-running P&L; correct because income/expense balances
        // are reset by FY-start convention).
        const incomeClose =
            Math.abs(closingOf(closingTree, "Sales Accounts")) +
            Math.abs(closingOf(closingTree, "Direct Incomes"))  +
            Math.abs(closingOf(closingTree, "Indirect Incomes"));
        const expenseClose =
            Math.abs(closingOf(closingTree, "Purchase Accounts")) +
            Math.abs(closingOf(closingTree, "Direct Expenses"))   +
            Math.abs(closingOf(closingTree, "Indirect Expenses"));
        const incomeOpen =
            Math.abs(closingOf(openingTree, "Sales Accounts")) +
            Math.abs(closingOf(openingTree, "Direct Incomes"))  +
            Math.abs(closingOf(openingTree, "Indirect Incomes"));
        const expenseOpen =
            Math.abs(closingOf(openingTree, "Purchase Accounts")) +
            Math.abs(closingOf(openingTree, "Direct Expenses"))   +
            Math.abs(closingOf(openingTree, "Indirect Expenses"));
        const periodProfit = (incomeClose - incomeOpen) - (expenseClose - expenseOpen);

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

        const totalSources      = sources.reduce((s, r) => s + r.amount, 0);
        const totalApplications = applications.reduce((s, r) => s + r.amount, 0);

        return NextResponse.json({
            from: from.toISOString(),
            to:   to.toISOString(),
            sources, applications,
            totalSources, totalApplications,
            workingCapital: { opening: openingWC, closing: closingWC, change: wcChange },
        });
    } catch (e) {
        return handleApiError(e, "Failed to compute fund flow");
    }
}
