// Live closing-stock valuation: SUM of every product's live value. Tally-style
// "Closing Stock" line for the Balance Sheet and P&L Trading account.
//
// Implementation lives in `src/modules/inventory/lib/valuation.ts`. PR 3 made
// the method configurable per render — the BS page passes through the user's
// dropdown selection (which defaults to OrgDefaults.valuationMethod). Older
// callers that don't care can omit the arg to use the org default.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { valueStockOrgTotal, type ValuationMethod } from "@/modules/inventory/lib/valuation";

export type ClosingStockResult = {
    /** Computed valuation in rupees (live). */
    computed: number;
    /** Number of products contributing (helpful for diagnostics). */
    productCount: number;
    /** Method actually used (echoed back for UI labels). */
    method: ValuationMethod;
};

export async function getClosingStockValue(
    method?: ValuationMethod,
): Promise<ClosingStockResult> {
    const resolvedMethod = method ?? await loadOrgDefaultValuationMethod();
    const r = await valueStockOrgTotal(resolvedMethod);
    return { computed: r.computed, productCount: r.productCount, method: r.method };
}

async function loadOrgDefaultValuationMethod(): Promise<ValuationMethod> {
    const row = await prisma.orgDefaults.findUnique({
        where:  { id: 1 },
        select: { valuationMethod: true },
    });
    return (row?.valuationMethod ?? "WEIGHTED_AVG") as ValuationMethod;
}
