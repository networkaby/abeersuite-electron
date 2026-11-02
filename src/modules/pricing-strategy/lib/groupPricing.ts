// ── Group pricing (Pricing Strategy → Group pricing) — POS only ──────────────
//
// A customer group carries a small price list: one rule per product group
// saying how that group's items are billed for its customers.
//
//   MRP              — the line starts at the item's MRP.
//   PRINT_PRICE      — the line starts at the printed barcode tag price.
//   PROFIT_SHARE     — pct% of the profit STILL LEFT after every other
//                      discount (tier, coupon, loyalty, a manual minus charge)
//                      is given back. No profit left → nothing more given.
//   REVENUE_DISCOUNT — pct% off the price left after those discounts, capped
//                      at the profit left, so it never sells below cost.
//
// The first two only move the line's STARTING price (chosen at add-to-cart,
// the cashier can still type over it). The last two are the group REBATE,
// worked out last, after every other discount, and taken silently out of the
// line's price before GST — nothing on the receipt or the customer display
// names it; the customer just pays less.
//
// Pure and client-safe: the POS preview (usePosBilling) and /api/pos/sale run
// the SAME `groupRebatesExcl` on the same inputs, so the bill the cashier
// collects is the bill the server posts. Server-side loading lives in
// groupPricingServer.ts.

import { calcLineTotals } from "@/modules/inventory/lib/voucherMath";
import { round2 } from "@/shared/lib/format";

export const GROUP_PRICE_TYPES = ["MRP", "PRINT_PRICE", "PROFIT_SHARE", "REVENUE_DISCOUNT"] as const;
export type GroupPriceType = (typeof GROUP_PRICE_TYPES)[number];

export const GROUP_PRICE_TYPE_LABEL: Record<GroupPriceType, string> = {
    MRP: "MRP",
    PRINT_PRICE: "Print price",
    PROFIT_SHARE: "Profit sharing",
    REVENUE_DISCOUNT: "Revenue discount",
};

/** Types that carry a % (the other two just pick a starting price). */
export const pctPriceType = (t: GroupPriceType): boolean => t === "PROFIT_SHARE" || t === "REVENUE_DISCOUNT";

export type GroupPriceRule = { type: GroupPriceType; pct: number | null };

/**
 * A customer's group pricing, resolved for the POS:
 *   byGroup — product-group id → the rule that governs it, already walked
 *             down the group tree (a rule on "CCTV" appears under every
 *             sub-group of CCTV that has no nearer rule of its own).
 *   all     — the "All items" row, for items in no ruled group (or no group).
 *   benefits — which automatic benefits the group may get.
 */
export type GroupPricing = {
    byGroup: Record<number, GroupPriceRule>;
    all: GroupPriceRule | null;
};

export type PartyBenefits = { tier: boolean; coupons: boolean; loyalty: boolean };
export const ALL_BENEFITS: PartyBenefits = { tier: true, coupons: true, loyalty: true };
export const NO_BENEFITS: PartyBenefits = { tier: false, coupons: false, loyalty: false };

/**
 * Walk each product group up its parent chain to the nearest ruled ancestor.
 * `groupParent` holds every product group (id → parentId). Cycles are cut by
 * a visited set — a bad parent loop must not hang a sale.
 */
export function expandGroupRules(
    rules: { productGroupId: number | null; priceType: GroupPriceType; pct: number | null }[],
    groupParent: Map<number, number | null>,
): GroupPricing {
    const direct = new Map<number, GroupPriceRule>();
    let all: GroupPriceRule | null = null;
    for (const r of rules) {
        const rule = { type: r.priceType, pct: r.pct };
        if (r.productGroupId == null) all = rule;
        else direct.set(r.productGroupId, rule);
    }
    const byGroup: Record<number, GroupPriceRule> = {};
    if (direct.size === 0) return { byGroup, all };
    for (const id of groupParent.keys()) {
        const seen = new Set<number>();
        let cur: number | null = id;
        while (cur != null && !seen.has(cur)) {
            const hit = direct.get(cur);
            if (hit) { byGroup[id] = hit; break; }
            seen.add(cur);
            cur = groupParent.get(cur) ?? null;
        }
    }
    return { byGroup, all };
}

/** The rule for one item, by its product group. null = normal pricing. */
export function ruleForGroup(pricing: GroupPricing | null | undefined, groupId: number | null | undefined): GroupPriceRule | null {
    if (!pricing) return null;
    return (groupId != null ? pricing.byGroup[groupId] : undefined) ?? pricing.all;
}

/**
 * Tax-inclusive starting price (paise) for a line under `rule`. MRP falls
 * back to the barcode price, then the sale price. Every other case starts at
 * the barcode price, falling back to the sale price.
 */
export function groupStartPricePaise(
    rule: GroupPriceRule | null,
    p: { salePaise: number | null | undefined; tagPaise: number | null | undefined; mrpPaise: number | null | undefined },
): number | null {
    const sale = p.salePaise ?? null;
    if (rule?.type === "MRP") return p.mrpPaise ?? p.tagPaise ?? sale;
    // Normal billing starts at the printed barcode tag too (PRINT_PRICE is now
    // the default); the sale price is the floor the cashier may type down to
    // (usePosBilling → lineFloorExcl).
    return p.tagPaise ?? sale;
}

export type RebateLine = {
    quantity: number;
    /** Pre-tax unit rate as sent to the sale (before any rebate). */
    unitPrice: number;
    taxRate: number;
    /** This line's pre-tax tier discount, after any coupon has dropped it. */
    tierDiscExcl: number;
    /** Pre-tax unit cost; null = no cost basis → no rebate on the line. */
    costExcl: number | null;
    /** Discount-protected product — never rebated, never takes a share. */
    protected: boolean;
    rule: GroupPriceRule | null;
};

/**
 * Per-line pre-tax rebate (rupees, 2 dp), index-aligned with `lines`.
 *
 * `billDiscountIncl` is every tax-inclusive bill-level discount — coupon,
 * on-top coupon, loyalty redemption and manual minus charges. It is spread
 * over the unprotected lines by their tax-inclusive value (after tier), and
 * backed out to pre-tax at each line's own GST rate. What is left of the line
 * over its cost is the profit left; the rule takes its share of that.
 */
export function groupRebatesExcl(lines: RebateLine[], billDiscountIncl: number): number[] {
    const netIncl = lines.map((l) => (l.protected ? 0 : calcLineTotals({
        quantity: l.quantity, rate: l.unitPrice, discountPct: 0, discountAmt: l.tierDiscExcl, taxRate: l.taxRate,
    }).amount));
    const base = netIncl.reduce((s, v) => s + v, 0);
    const pool = Math.max(0, billDiscountIncl);
    return lines.map((l, i) => {
        const rule = l.rule;
        if (!rule || !pctPriceType(rule.type) || l.protected || l.costExcl == null || l.quantity <= 0) return 0;
        const pct = Math.max(0, Math.min(100, rule.pct ?? 0)) / 100;
        if (pct <= 0) return 0;
        const share = base > 0 ? (pool * netIncl[i]) / base : 0;
        const afterExcl = (netIncl[i] - share) / (1 + l.taxRate / 100);
        const profitLeft = afterExcl - l.costExcl * l.quantity;
        if (profitLeft <= 0) return 0;
        const rebate = rule.type === "PROFIT_SHARE"
            ? pct * profitLeft
            : Math.min(pct * afterExcl, profitLeft);
        return round2(Math.max(0, rebate));
    });
}

/** Unit rate after the rebate — what the voucher line posts. */
export const rebatedRate = (unitPrice: number, quantity: number, rebateExcl: number): number =>
    rebateExcl > 0 && quantity > 0 ? unitPrice - rebateExcl / quantity : unitPrice;
