import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { parseAsOf, indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    aggregateClosingAsOf, loadNormalBalanceMap, netProfitLoss,
} from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree, type GroupNode } from "@/modules/accountancy/lib/groupTree";
import { getClosingStockValue } from "@/modules/accountancy/lib/closingStock";

// GET /api/finance/reports/balance-sheet?asOf=YYYY-MM-DD
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOf = parseAsOf(searchParams);

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
        const stockResult = await getClosingStockValue();
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
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to generate balance sheet");
    }
}
