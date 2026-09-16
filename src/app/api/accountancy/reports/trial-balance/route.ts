import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange, indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { getClosingStockValue } from "@/modules/accountancy/lib/closingStock";
import { aggregateRange, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import {
    buildGroupTree, injectLedger, sumGroupLedgers,
    STOCK_GROUP, SYNTHETIC_STOCK_ID,
} from "@/modules/accountancy/lib/groupTree";
import { computeTradingStockAdjustment } from "@/modules/accountancy/lib/tradingStockAdjustment";
import { handleApiError } from "@/shared/lib/api";
import { startOfDayUtc, endOfDayUtc, toDateOnlyUtc } from "@/shared/lib/format/formatDate";

// Heavy aggregation: full-range GL groupBy across every account. Give Vercel
// headroom past the default 10s function limit so large datasets don't 504.
export const maxDuration = 60;

// GET /api/accountancy/reports/trial-balance?from=YYYY-MM-DD&to=YYYY-MM-DD
//   (asOf is supported for backwards-compat: if no from/to, default range = FY → asOf)
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get("asOf");

    let from: Date;
    let to: Date;
    if (asOfParam && !searchParams.get("from") && !searchParams.get("to")) {
        // UTC-pinned like `parseRange`, not local midnight — `UniversalVoucher.date`
        // is a DATE column, so a local bound truncates a day early in IST.
        const asOfBound = endOfDayUtc(asOfParam);
        const fyYear = asOfBound.getUTCMonth() < 3 ? asOfBound.getUTCFullYear() - 1 : asOfBound.getUTCFullYear();
        from = startOfDayUtc(`${fyYear}-04-01`);
        to = asOfBound;
    } else {
        const r = parseRange(searchParams);
        from = r.from; to = r.to;
    }

    try {
        const nbMap = await loadNormalBalanceMap();
        const aggMap = await aggregateRange(from, to, nbMap);
        const tree = await buildGroupTree(aggMap);

        // ── Closing Stock ───────────────────────────────────────────────
        // Stock never reaches a GL account (see STOCK_GROUP in groupTree), so
        // the Trial Balance has to surface the valuation itself — exactly as
        // the Balance Sheet does. Without it the Dr side is short by the whole
        // value of the godown and the entire amount lands in the page's
        // "Difference in opening balances" plug, which is what made the two
        // reports disagree.
        //
        // Unlike the Balance Sheet (a single as-at date) the Trial Balance has
        // an Opening column too, so BOTH ends are valued: opening as at the
        // instant before `from`, closing as at `to`. The Transactions columns
        // stay nil — stock movement is a valuation change, not a journal entry.
        const { openingStock, closingStock } = await computeTradingStockAdjustment(from, to);
        // Stock as at the financial-year start — the anchor the P&L ledgers are
        // already accumulating from. Costs nothing extra for the usual
        // "1 April to date" period, where it IS the opening figure.
        const fyStart = indianFiscalYearStart(from);
        const stockAtFyStart = fyStart.getTime() >= from.getTime()
            ? openingStock
            : (await getClosingStockValue(undefined, new Date(fyStart.getTime() - 1))).computed;

        const stockGl      = sumGroupLedgers(tree, STOCK_GROUP);
        const stockOpening = openingStock - stockGl.opening;
        const stockClosing = closingStock - stockGl.closing;
        if (Math.abs(stockOpening) >= 0.005 || Math.abs(stockClosing) >= 0.005) {
            injectLedger(tree, STOCK_GROUP, {
                id: SYNTHETIC_STOCK_ID,          // sentinel — no real Account row
                name: "Closing Stock (live)",
                code: null,
                normalBalance: "DEBIT",
                personId: null,
                companyId: null,
                opening: stockOpening,
                debits:  0,
                credits: 0,
                closing: stockClosing,
            });
        }

        let totalOpening = 0, totalDebits = 0, totalCredits = 0, totalClosing = 0;
        const walk = (nodes: typeof tree): void => {
            for (const n of nodes) {
                walk(n.children);
                for (const l of n.ledgers) {
                    totalOpening += l.opening;
                    totalDebits  += l.debits;
                    totalCredits += l.credits;
                    totalClosing += l.closing;
                }
            }
        };
        walk(tree);

        return NextResponse.json({
            from: toDateOnlyUtc(from),
            to:   toDateOnlyUtc(to),
            tree,
            totals: {
                opening: totalOpening,
                debits:  totalDebits,
                credits: totalCredits,
                closing: totalClosing,
            },
            // Mirrors the Balance Sheet's block so the reader can see where the
            // stock figure came from, and tell a live valuation from a posted one.
            //
            // `atFyStart` is what lets the page balance a period that does NOT
            // begin on 1 April. Income and expense ledgers carry their
            // year-to-date figure in the Opening column, so the stock consumed
            // between the financial-year start and the period start has to be
            // carried the same way. Without it, a mid-year Trial Balance is out
            // by exactly that much in BOTH columns.
            closingStock: {
                atFyStart:  stockAtFyStart,
                opening:    openingStock,
                computed:   closingStock,
                postedToGl: stockGl.closing,
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to generate trial balance");
    }
}
