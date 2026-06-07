// POS Estimate print — which discount lines are SHOWN on the customer-facing
// estimate printout/display. Price-privacy (Order-to-Cash): the cashier's screen
// always shows discounts to negotiate; the customer copy hides them by default,
// showing only the tag/list price. Stored on OrgDefaults.posEstimateShowDiscountsJson.
//
// Plain lib (no "use client") so both the settings form and the server-side
// receipt builder can import it.

export type EstimateDiscountVisibility = {
    tier: boolean;
    loyalty: boolean;
    coupon: boolean;
    manual: boolean;
};

// Default = everything HIDDEN (Option A: customer sees the tag price, no discount).
export const DEFAULT_ESTIMATE_DISCOUNT_VISIBILITY: EstimateDiscountVisibility = {
    tier: false,
    loyalty: false,
    coupon: false,
    manual: false,
};

export const ESTIMATE_DISCOUNT_LABELS: Record<keyof EstimateDiscountVisibility, string> = {
    tier: "Tier / level discount",
    loyalty: "Loyalty redemption",
    coupon: "Coupon discount",
    manual: "Manual / counter discount",
};

export function normalizeEstimateDiscountVisibility(raw: unknown): EstimateDiscountVisibility {
    if (!raw || typeof raw !== "object") return { ...DEFAULT_ESTIMATE_DISCOUNT_VISIBILITY };
    const r = raw as Record<string, unknown>;
    const pick = (k: keyof EstimateDiscountVisibility) =>
        typeof r[k] === "boolean" ? (r[k] as boolean) : DEFAULT_ESTIMATE_DISCOUNT_VISIBILITY[k];
    return { tier: pick("tier"), loyalty: pick("loyalty"), coupon: pick("coupon"), manual: pick("manual") };
}
