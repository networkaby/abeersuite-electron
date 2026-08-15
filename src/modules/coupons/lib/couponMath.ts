// Pure coupon math — no DB, no side effects. Mirrors loyaltyMath.ts: the route
// composes these with the tx-aware helpers in applyCoupon.ts. Keeping the ₹
// computation pure lets the POS and the server run the IDENTICAL calculation so
// the displayed total always matches the posted total.

import { round2 as r2 } from "@/shared/lib/format/moneyInr";

export type CouponType = "PERCENT" | "FLAT" | "FREE_ITEM" | "BOGO" | "SET_PRICE";
export type CouponChannel = "POS" | "SHOP" | "BOTH";
export type CouponApplyMode = "CODE" | "AUTO";
export type CouponEligibility = "ANY" | "NEW" | "RETURNING";
/// See CouponStackScope in the schema. Only meaningful when `stackable` is false.
export type CouponStackScope = "BILL" | "LINE";

/// One include/exclude rule on a coupon. The set taxonomy fields are ANDed
/// together (see lineMatchesRule); rules of the same kind are ORed.
export interface CouponRuleLite {
    kind: "INCLUDE" | "EXCLUDE";
    productId: number | null;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
}

/// A coupon narrowed to plain numbers (Prisma Decimals already converted) plus
/// its include/exclude rules — everything the pure engine needs.
export interface CouponContext {
    id: number;
    code: string | null;
    name: string;
    type: CouponType;
    channels: CouponChannel;
    applyMode: CouponApplyMode;
    percentOff: number | null;
    maxDiscountAmt: number | null;
    flatAmt: number | null;
    freeProductId: number | null;
    freeQty: number | null;
    freeDiscountPct: number | null;
    buyProductId: number | null;
    buyQty: number | null;
    getQty: number | null;
    setPriceAmt: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
    minBillValue: number | null;
    eligibility: CouponEligibility;
    stackable: boolean;
    stackScope: CouponStackScope;
    ownerAccountId: number | null;
    isActive: boolean;
    totalUsageLimit: number | null;
    perCustomerLimit: number | null;
    singleUse: boolean;
    rules: CouponRuleLite[];
}

/// A cart line reduced to what coupon eligibility + value need (pre-tax goods).
export interface CartLineLite {
    productId: number;
    groupId: number | null;
    categoryId: number | null;
    brandId: number | null;
    qty: number;
    unitPrice: number; // pre-tax unit goods price
    /// Unit COST incl. tax (rupees) — the base for PERCENT coupons, so every
    /// %-type discount is measured on the same base as the pricing margin
    /// (cost+tax) and a coupon% ≤ margin% can never give away more than the
    /// margin. null/absent = no cost basis → the line adds nothing to a
    /// PERCENT coupon's base (same rule as the spend-tier discount).
    costIncl?: number | null;
}

export interface EvalInput {
    accountId: number | null;
    lines: CartLineLite[];
    /// Σ line goods (pre-tax, pre-discount) — basis for min-bill + eligible subtotal.
    goodsValue: number;
    /// The bill the coupon caps against (goods − tier − loyalty). The coupon ₹ is
    /// clamped strictly below this so the voucher total never reaches ≤ 0 (which
    /// would make postInvVoucherToGl skip the GL post).
    billBeforeCoupon: number;
    isNewCustomer: boolean;
    now: Date;
}

export type EvalOk = { ok: true; discountRupees: number };
export type EvalFail = { ok: false; reason: string };
export type EvalResult = EvalOk | EvalFail;

const lineGoods = (l: CartLineLite): number => l.qty * l.unitPrice;

/// Does a cart line match an include/exclude rule? EVERY taxonomy field set on the
/// rule must match the line (AND) — so product + category + group + brand narrow
/// each other, e.g. brand Samsung AND category Phones = Samsung phones only. A rule
/// with nothing set matches nothing. Matches are direct: the category / group trees
/// are NOT walked, so a rule on a parent does not catch its children (note for later).
function lineMatchesRule(line: CartLineLite, rule: CouponRuleLite): boolean {
    let anySet = false;
    if (rule.productId != null) {
        if (line.productId !== rule.productId) return false;
        anySet = true;
    }
    if (rule.categoryId != null) {
        if (line.categoryId !== rule.categoryId) return false;
        anySet = true;
    }
    if (rule.groupId != null) {
        if (line.groupId !== rule.groupId) return false;
        anySet = true;
    }
    if (rule.brandId != null) {
        if (line.brandId !== rule.brandId) return false;
        anySet = true;
    }
    return anySet;
}

/// Which of `lines` this coupon's own INCLUDE/EXCLUDE rules match, in order.
/// With no INCLUDE rules, every line matches except those an EXCLUDE rule hits.
/// With INCLUDE rules, only included lines (still minus excludes) match. Shared
/// by eligibleSubtotal, eligibleCostBase, the SET_PRICE discount, and the
/// per-line tier/loyalty exclusion mask (couponExclusionMask) — one place owns
/// "does this coupon apply to this line".
export function linesMatchedByRules(c: CouponContext, lines: CartLineLite[]): boolean[] {
    const includes = c.rules.filter((r) => r.kind === "INCLUDE");
    const excludes = c.rules.filter((r) => r.kind === "EXCLUDE");
    return lines.map((line) => {
        if (excludes.some((r) => lineMatchesRule(line, r))) return false;
        if (includes.length > 0 && !includes.some((r) => lineMatchesRule(line, r))) return false;
        return true;
    });
}

/// Σ goods of the lines the coupon applies to.
export function eligibleSubtotal(c: CouponContext, lines: CartLineLite[]): number {
    const matched = linesMatchedByRules(c, lines);
    return r2(lines.reduce((s, l, i) => (matched[i] ? s + lineGoods(l) : s), 0));
}

/// Σ COST (incl. tax) of the eligible lines — the PERCENT-coupon base. Lines
/// with no cost basis add 0.
export function eligibleCostBase(c: CouponContext, lines: CartLineLite[]): number {
    const matched = linesMatchedByRules(c, lines);
    return r2(lines.reduce((s, l, i) => (matched[i] && l.costIncl != null ? s + l.qty * l.costIncl : s), 0));
}

/// Per-line "should this line's tier + loyalty be excluded" decision for a
/// SELECTED, non-null coupon (call only when a coupon is actually applying).
/// stackable ⇒ nothing excluded. !stackable + BILL scope ⇒ every line excluded
/// (today's whole-bill drop). !stackable + LINE scope ⇒ only the lines this
/// coupon's own rules match are excluded — other lines in the same bill keep
/// their tier/loyalty untouched.
export function couponExclusionMask(c: CouponContext, lines: CartLineLite[]): boolean[] {
    if (c.stackable) return lines.map(() => false);
    if (c.stackScope === "LINE") return linesMatchedByRules(c, lines);
    return lines.map(() => true);
}

/// Gate a coupon against the cart: active, window, min-bill, eligibility, owner,
/// and "applies to at least one line". Pure — no usage-limit check (that needs DB).
export function checkCouponEligibility(c: CouponContext, input: EvalInput): { ok: true } | EvalFail {
    if (!c.isActive) return { ok: false, reason: "Coupon is not active" };
    if (c.startsAt && input.now < c.startsAt) return { ok: false, reason: "Coupon is not yet valid" };
    if (c.endsAt && input.now > c.endsAt) return { ok: false, reason: "Coupon has expired" };
    if (c.minBillValue != null && input.goodsValue < c.minBillValue) {
        return { ok: false, reason: `Minimum bill of ₹${c.minBillValue} required` };
    }
    if (c.ownerAccountId != null && c.ownerAccountId !== input.accountId) {
        return { ok: false, reason: "Coupon belongs to another customer" };
    }
    if (c.eligibility === "NEW" && !input.isNewCustomer) return { ok: false, reason: "Only for first-time customers" };
    if (c.eligibility === "RETURNING" && input.isNewCustomer) return { ok: false, reason: "Only for returning customers" };
    if (eligibleSubtotal(c, input.lines) <= 0) return { ok: false, reason: "No eligible items in the cart" };
    return { ok: true };
}

/// Compute the ₹ discount for a coupon (after eligibility passes). Clamps to the
/// eligible subtotal and to billBeforeCoupon − 0.01 (bill must stay > 0).
export function computeCouponDiscount(c: CouponContext, input: EvalInput): EvalResult {
    const gate = checkCouponEligibility(c, input);
    if (!gate.ok) return gate;

    const elig = eligibleSubtotal(c, input.lines);
    let raw = 0;
    switch (c.type) {
        case "PERCENT": {
            if (c.percentOff == null) return { ok: false, reason: "Coupon misconfigured (no %)" };
            // % of COST (incl. tax) of the eligible lines — the same base the pricing
            // margin uses, so coupon% and margin% at the same rate are the identical
            // rupee amount. Lines with no cost basis contribute nothing; still
            // clamped to the eligible SALE value so it can't exceed what those
            // lines actually charge.
            raw = Math.min(eligibleCostBase(c, input.lines) * (c.percentOff / 100), elig);
            if (c.maxDiscountAmt != null) raw = Math.min(raw, c.maxDiscountAmt);
            break;
        }
        case "FLAT": {
            if (c.flatAmt == null) return { ok: false, reason: "Coupon misconfigured (no amount)" };
            raw = Math.min(c.flatAmt, elig);
            break;
        }
        case "FREE_ITEM": {
            // Discount a specific item already in the cart by freeDiscountPct
            // (100 = free) for up to freeQty units. Rides the same whole-bill
            // negative-charge path — no extra cart line is added.
            if (c.freeProductId == null) return { ok: false, reason: "Coupon misconfigured (no item)" };
            const line = input.lines.find((l) => l.productId === c.freeProductId);
            if (!line) return { ok: false, reason: "Add the offer item to the cart" };
            const qty = Math.min(c.freeQty ?? 1, line.qty);
            const pctOff = c.freeDiscountPct ?? 100;
            raw = qty * line.unitPrice * (pctOff / 100);
            break;
        }
        case "BOGO": {
            // Buy X get Y. Get-item = freeProductId (or the buy item for same-item
            // BOGO). The get units are discounted by freeDiscountPct (100 = free).
            const buyQty = c.buyQty ?? 1;
            const getQty = c.getQty ?? 1;
            const getProductId = c.freeProductId ?? c.buyProductId;
            if (getProductId == null) return { ok: false, reason: "Coupon misconfigured (no item)" };
            const getLine = input.lines.find((l) => l.productId === getProductId);
            if (!getLine) return { ok: false, reason: "Add the offer item to the cart" };
            const pctOff = c.freeDiscountPct ?? 100;
            const sameItem = c.buyProductId == null || c.freeProductId == null || c.freeProductId === c.buyProductId;
            let freeUnits: number;
            if (sameItem) {
                // Group of (buyQty + getQty); every full group yields getQty free.
                const units = c.buyProductId != null
                    ? (input.lines.find((l) => l.productId === c.buyProductId)?.qty ?? 0)
                    : input.lines.reduce((s, l) => s + l.qty, 0);
                freeUnits = Math.floor(units / (buyQty + getQty)) * getQty;
            } else {
                // Cross-item: every buyQty of the buy item unlocks getQty of the get item.
                const buyUnits = input.lines.find((l) => l.productId === c.buyProductId)?.qty ?? 0;
                freeUnits = Math.floor(buyUnits / buyQty) * getQty;
            }
            freeUnits = Math.min(freeUnits, getLine.qty);
            if (freeUnits <= 0) return { ok: false, reason: "Buy more to unlock the offer" };
            raw = freeUnits * getLine.unitPrice * (pctOff / 100);
            break;
        }
        case "SET_PRICE": {
            // Reverse-computed ₹ discount so eligible lines net down to setPriceAmt
            // per unit — rides the same negative-charge + print/GL path as every
            // other coupon type (a ₹100 item set to ₹80 just prints "Coupon −₹20").
            if (c.setPriceAmt == null) return { ok: false, reason: "Coupon misconfigured (no set price)" };
            const matched = linesMatchedByRules(c, input.lines);
            raw = input.lines.reduce((s, l, i) => (matched[i] ? s + l.qty * Math.max(0, l.unitPrice - c.setPriceAmt!) : s), 0);
            break;
        }
    }

    // Never drive the bill to ≤ 0 (postInvVoucherToGl skips GL when total ≤ 0).
    const ceiling = Math.max(0, input.billBeforeCoupon - 0.01);
    const discount = r2(Math.min(raw, ceiling));
    if (discount <= 0) return { ok: false, reason: "Coupon yields no discount on this bill" };
    return { ok: true, discountRupees: discount };
}

/// One-shot finalizer shared by /api/pos/sale and /api/pos/coupon-validate so the
/// validated ₹ and the posted ₹ are identical. `tierRupees` / `loyaltyRupees` must
/// already reflect the caller's stacking decision (see couponExclusionMask) — this
/// only applies the hard ceiling so the post-discount bill stays > 0, and the
/// global discount-% guard.
export function finalizeCouponAmount(args: {
    selectedDiscount: number; // coupon-alone ₹ from computeCouponDiscount
    tierRupees: number; // already exclusivity-adjusted by the caller
    loyaltyRupees: number; // already exclusivity-adjusted by the caller
    goodsValue: number;
    maxTotalDiscountPct: number | null;
}): { couponRupees: number; clampedByGuard: boolean } {
    const { selectedDiscount, tierRupees, loyaltyRupees, goodsValue, maxTotalDiscountPct } = args;
    // Keep goods − tier − loyalty − coupon strictly > 0.
    const ceiling = Math.max(0, goodsValue - tierRupees - loyaltyRupees - 0.01);
    const guard = applyGlobalDiscountGuard({
        couponRupees: Math.min(selectedDiscount, ceiling),
        tierRupees, loyaltyRupees, billGoods: goodsValue, maxTotalDiscountPct,
    });
    return { couponRupees: r2(guard.couponRupees), clampedByGuard: guard.clamped };
}

/// Global guard: clamp the COUPON portion so coupon + tier + loyalty never exceed
/// maxTotalDiscountPct of the bill goods. null guard = no clamp.
export function applyGlobalDiscountGuard(args: {
    couponRupees: number;
    tierRupees: number;
    loyaltyRupees: number;
    billGoods: number;
    maxTotalDiscountPct: number | null;
}): { couponRupees: number; clamped: boolean } {
    const { couponRupees, tierRupees, loyaltyRupees, billGoods, maxTotalDiscountPct } = args;
    if (maxTotalDiscountPct == null) return { couponRupees, clamped: false };
    const maxTotal = billGoods * (maxTotalDiscountPct / 100);
    const allowedForCoupon = Math.max(0, maxTotal - tierRupees - loyaltyRupees);
    if (couponRupees <= allowedForCoupon) return { couponRupees, clamped: false };
    return { couponRupees: r2(allowedForCoupon), clamped: true };
}
