import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { parseAsOf, indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { handleApiError } from "@/shared/lib/api";
import {
    aggregateClosingAsOf, loadNormalBalanceMap, netProfitLoss,
} from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree, type GroupNode } from "@/modules/accountancy/lib/groupTree";
import { getClosingStockValue } from "@/modules/accountancy/lib/closingStock";
import { VALUATION_METHODS, type ValuationMethod } from "@/modules/inventory/lib/valuation";

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
    const { response } = await requireModuleAccess("accountancy");
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

        // ── Closing Stock (live valuation) ──────────────────────────────
        const stockResult = await getClosingStockValue(overrideMethod);
        const stockGlBalance = (() => {
            // Sum of GL balance for accounts under "Stock-in-Hand" group
            let s = 0;
            const walk = (nodes: GroupNode[]): void => {
                for (const n of nodes) {
                    if (n.name === "Stock-in-Hand") {
                        for (const l of n.ledgers) s += l.closing;
                    }
                    walk(n.children);
                }
            };
            walk(tree);
            return s;
        })();

        // Tally convention: closing stock isn't posted per voucher to a GL
        // ledger. We surface it as a synthetic ledger inside Stock-in-Hand so
        // the reader sees the value where they expect (under Current Assets),
        // and the existing tree-renderer rolls it up into Stock-in-Hand and
        // Current Assets totals naturally.
        const liveStockDelta = stockResult.computed - stockGlBalance;
        if (liveStockDelta !== 0) {
            const inject = (nodes: GroupNode[]): boolean => {
                for (const n of nodes) {
                    if (n.name === "Stock-in-Hand") {
                        n.ledgers.push({
                            id: -1,                          // sentinel — no real Account row
                            name: "Closing Stock (live)",
                            code: null,
                            normalBalance: "DEBIT",
                            personId: null,
                            companyId: null,
                            opening: 0,
                            debits:  0,
                            credits: 0,
                            closing: liveStockDelta,
                        });
                        n.rolledUpClosing += liveStockDelta;
                        return true;
                    }
                    if (inject(n.children)) {
                        n.rolledUpClosing += liveStockDelta;  // bubble up Current Assets etc.
                        return true;
                    }
                }
                return false;
            };
            inject(assets);
        }

        // ── Net P&L for current FY → surface under Capital Account ──────
        const fyStart = indianFiscalYearStart(asOf);
        const netPl   = await netProfitLoss(fyStart, asOf);

        return NextResponse.json({
            asOf:         asOf.toISOString(),
            fyStart:      fyStart.toISOString(),
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
