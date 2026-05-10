import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { aggregateRange, loadNormalBalanceMap } from "@/modules/accountancy/lib/aggregateLedger";
import { buildGroupTree } from "@/modules/accountancy/lib/groupTree";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// GET /api/finance/reports/trial-balance?from=YYYY-MM-DD&to=YYYY-MM-DD
//   (asOf is supported for backwards-compat: if no from/to, default range = FY → asOf)
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get("asOf");

    let from: Date;
    let to: Date;
    if (asOfParam && !searchParams.get("from") && !searchParams.get("to")) {
        const parsedAsOf = new Date(asOfParam);
        parsedAsOf.setHours(23, 59, 59, 999);
        const fyYear = parsedAsOf.getMonth() < 3 ? parsedAsOf.getFullYear() - 1 : parsedAsOf.getFullYear();
        from = new Date(fyYear, 3, 1, 0, 0, 0, 0);
        to = parsedAsOf;
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
            from: from.toISOString(),
            to:   to.toISOString(),
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
