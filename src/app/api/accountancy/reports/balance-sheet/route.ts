import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseAsOf, indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { handleApiError } from "@/shared/lib/api";
import {
    aggregateClosingAsOf, loadNormalBalanceMap, netProfitLoss,
} from "@/modules/accountancy/lib/aggregateLedger";
import {
    buildGroupTree, injectLedger, sumGroupLedgers,
    STOCK_GROUP, SYNTHETIC_STOCK_ID, type GroupNode,
} from "@/modules/accountancy/lib/groupTree";
import { getClosingStockValue } from "@/modules/accountancy/lib/closingStock";
import { VALUATION_METHODS, type ValuationMethod } from "@/modules/inventory/lib/valuation";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";

// Heavy aggregation: full-GL closing balances + a whole-inventory stock
// valuation walk. Give Vercel headroom past the default 10s function limit so
// large datasets don't 504.
export const maxDuration = 60;

// GET /api/accountancy/reports/balance-sheet?asOf=YYYY-MM-DD&valuationMethod=...
//
// `valuationMethod` overrides OrgDefaults.valuationMethod for this render.
// Defaults to the org setting when omitted; lets the BS page preview other
// methods without changing the persistent default.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOf = parseAsOf(searchParams);
    const methodParam = searchParams.get("valuationMethod");
    const overrideMethod: ValuationMethod | undefined =
        methodParam && VALUATION_METHODS.includes(methodParam as ValuationMethod)
            ? (methodParam as ValuationMethod)
            : undefined;

    try {
        const nbMap = await loadNormalBalanceMap();
        const closingMap = await aggregateClosingAsOf(asOf, nbMap);

        // Wrap closing-only into AccountAggregate shape for groupTree
        const aggMap = new Map<number, {
            accountId: number; opening: number; debits: number; credits: number; closing: number;
        }>();
        for (const [id, c] of closingMap) {
            aggMap.set(id, { accountId: id, opening: 0, debits: 0, credits: 0, closing: c });
        }

        const tree = await buildGroupTree(aggMap, { types: ["ASSET", "LIABILITY"] });
        const liabilities = tree.filter((n) => n.type === "LIABILITY");
        const assets      = tree.filter((n) => n.type === "ASSET");

        // Tally convention: Suspense A/c is catalog-assigned to Assets, but a
        // ledger with a credit balance (rolledUpClosing < 0 under the
        // debit-normal Asset convention) reads as a liability, not an asset —
        // Tally moves it to the Liabilities side and shows it as a normal
        // positive credit figure there. Relocating (rather than leaving it
        // negative inside Assets) keeps both sides balanced either way.
        const suspenseIdx = assets.findIndex((n) => n.name === "Suspense A/c");
        if (suspenseIdx !== -1 && assets[suspenseIdx].rolledUpClosing < 0) {
            const [suspense] = assets.splice(suspenseIdx, 1);
            const flipToCredit = (n: GroupNode): void => {
                n.rolledUpClosing = -n.rolledUpClosing;
                for (const l of n.ledgers) l.closing = -l.closing;
                n.children.forEach(flipToCredit);
            };
            flipToCredit(suspense);
            suspense.type = "LIABILITY";
            liabilities.push(suspense);
            liabilities.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        }

        // ── Closing Stock (valued AS AT `asOf`, not live) ───────────────
        // A back-dated Balance Sheet must show the stock that existed on that
        // date, not today's — otherwise it can't tie to the P&L for the same
        // period, whose Closing Stock is also as-at.
        const stockResult = await getClosingStockValue(overrideMethod, asOf);

        // Tally convention: closing stock isn't posted per voucher to a GL
        // ledger. We surface it as a synthetic ledger inside Stock-in-Hand so
        // the reader sees the value where they expect (under Current Assets),
        // and the existing tree-renderer rolls it up into Stock-in-Hand and
        // Current Assets totals naturally. The Trial Balance does the same with
        // the same helpers — when these two drifted apart, the reports stopped
        // agreeing on Current Assets.
        const stockGlBalance = sumGroupLedgers(assets, STOCK_GROUP).closing;
        const liveStockDelta = stockResult.computed - stockGlBalance;
        if (liveStockDelta !== 0) {
            injectLedger(assets, STOCK_GROUP, {
                id: SYNTHETIC_STOCK_ID,          // sentinel — no real Account row
                name: "Closing Stock (live)",
                normalBalance: "DEBIT",
                personId: null,
                companyId: null,
                opening: 0,
                debits:  0,
                credits: 0,
                closing: liveStockDelta,
            });
        }

        // ── Net P&L for current FY → surface under Capital Account ──────
        const fyStart = indianFiscalYearStart(asOf);
        const netPl   = await netProfitLoss(fyStart, asOf);

        return NextResponse.json({
            // Plain calendar dates, not the UTC query bounds — see toDateOnlyUtc.
            asOf:         toDateOnlyUtc(asOf),
            fyStart:      toDateOnlyUtc(fyStart),
            liabilities,
            assets,
            netProfitLoss: netPl,        // Liabilities side adjustment
            closingStock: {
                computed:       stockResult.computed,
                postedToGl:     stockGlBalance,
                diff:           stockResult.computed - stockGlBalance,
                productCount:   stockResult.productCount,
                method:         stockResult.method,
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to generate balance sheet");
    }
}
