import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { parseAsOf, indianFiscalYearStart } from "@/modules/tally/lib/period";
import {
    aggregateClosingAsOf, loadNormalBalanceMap, netProfitLoss,
} from "@/modules/tally/lib/aggregateLedger";
import { buildGroupTree } from "@/modules/tally/lib/groupTree";
import { getClosingStockValue } from "@/modules/tally/lib/closingStock";

// GET /api/finance/reports/balance-sheet?asOf=YYYY-MM-DD
export async function GET(req: Request) {
    const { response } = await requireAuth();
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
            const walk = (nodes: typeof tree): void => {
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
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to generate balance sheet" }, { status: 500 });
    }
}
