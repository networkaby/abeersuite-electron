import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { aggregateRange, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree } from "@/modules/accountancy/lib/groupTree";
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
        });
    } catch (e) {
        return handleApiError(e, "Failed to generate trial balance");
    }
}
