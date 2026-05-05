import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { parseRange } from "@/modules/tally/lib/period";
import { aggregateRange, loadNormalBalanceMap } from "@/modules/tally/lib/aggregateLedger";
import { buildGroupTree } from "@/modules/tally/lib/groupTree";
import { getClosingStockValue } from "@/modules/tally/lib/closingStock";
import { prisma } from "@/lib/prisma";

// GET /api/finance/reports/profit-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
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

        // Closing stock at start = at start of period
        const openingDate = new Date(from);
        openingDate.setDate(openingDate.getDate() - 1);
        // We can't time-travel stock easily — use 0 as a fallback, or compute approximated.
        // Strategy: opening stock = current stock - net stock movements during the period.
        const stockNow = await getClosingStockValue();

        // Net stock movements over the period (in/out × rate)
        const stockMoves = await prisma.invStockLedger.findMany({
            where: { date: { gte: from, lte: to } },
            select: { inQty: true, outQty: true, rate: true, product: { select: { costPaise: true } } },
        });
        let netInValue  = 0;
        let netOutValue = 0;
        for (const m of stockMoves) {
            const r = Number(m.rate);
            netInValue  += Number(m.inQty)  * r;
            netOutValue += Number(m.outQty) * (m.product.costPaise ? m.product.costPaise / 100 : r);
        }
        const openingStock = Math.max(0, stockNow.computed - netInValue + netOutValue);
        const closingStock = stockNow.computed;

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
