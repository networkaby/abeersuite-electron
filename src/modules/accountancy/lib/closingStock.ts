// Live closing-stock valuation: SUM of every product's live value. Tally-style
// "Closing Stock" line for the Balance Sheet and P&L Trading account.
//
// Implementation lives in `src/modules/inventory/lib/valuation.ts`; this file
// kept as a back-compat surface so existing callers (Balance Sheet, P&L) don't
// need to know about valuation methods. New callers should use
// `valueStockOrgTotal(method)` directly.

import { valueStockOrgTotal } from "@/modules/inventory/lib/valuation";

export type ClosingStockResult = {
    /** Computed valuation in rupees (live). */
    computed: number;
    /** Number of products contributing (helpful for diagnostics). */
    productCount: number;
};

export async function getClosingStockValue(): Promise<ClosingStockResult> {
    const r = await valueStockOrgTotal("LAST_COST");
    return { computed: r.computed, productCount: r.productCount };
}
