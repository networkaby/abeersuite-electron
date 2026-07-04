// Pure coupon math — no DB, no side effects. Mirrors loyaltyMath.ts: the route
// composes these with the tx-aware helpers in applyCoupon.ts. Keeping the ₹
// computation pure lets the POS and the server run the IDENTICAL calculation so
// the displayed total always matches the posted total.

import { round2 as r2 } from "@/shared/lib/format/moneyInr";

export type CouponType = "PERCENT" | "FLAT" | "FREE_ITEM" | "BOGO";
export type CouponChannel = "POS" | "SHOP" | "BOTH";
export type CouponApplyMode = "CODE" | "AUTO";
export type CouponEligibility = "ANY" | "NEW" | "RETURNING";

/// One include/exclude rule on a coupon.
export interface CouponRuleLite {
    kind: "INCLUDE" | "EXCLUDE";
    productId: number | null;
    categoryId: number | null;
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
    startsAt: Date | null;
    endsAt: Date | null;
    minBillValue: number | null;
    eligibility: CouponEligibility;
    stackable: boolean;
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
    qty: number;
    unitPrice: number; // pre-tax unit goods price
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

/// Does a cart line match an include/exclude rule? Direct product or category
/// match (Phase 1 does not walk the category tree — note for later).
function lineMatchesRule(line: CartLineLite, rule: CouponRuleLite): boolean {
    if (rule.productId != null) return line.productId === rule.productId;
    if (rule.categoryId != null) return line.categoryId === rule.categoryId;
    return false;
}

/// Σ goods of the lines the coupon applies to. With no INCLUDE rules, every line
/// is eligible except those matched by an EXCLUDE rule. With INCLUDE rules, only
/// included lines (still minus excludes) count.
export function eligibleSubtotal(c: CouponContext, lines: CartLineLite[]): number {
    const includes = c.rules.filter((r) => r.kind === "INCLUDE");
    const excludes = c.rules.filter((r) => r.kind === "EXCLUDE");
    let sum = 0;
    for (const line of lines) {
        if (excludes.some((r) => lineMatchesRule(line, r))) continue;
        if (includes.length > 0 && !includes.some((r) => lineMatchesRule(line, r))) continue;
        sum += lineGoods(line);
    }
    return r2(sum);
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
            raw = elig * (c.percentOff / 100);
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
    }

    // Never drive the bill to ≤ 0 (postInvVoucherToGl skips GL when total ≤ 0).
    const ceiling = Math.max(0, input.billBeforeCoupon - 0.01);
    const discount = r2(Math.min(raw, ceiling));
    if (discount <= 0) return { ok: false, reason: "Coupon yields no discount on this bill" };
    return { ok: true, discountRupees: discount };
}

/// Stacking decision. A non-stackable coupon is the ONLY discount: it replaces
/// the spend-tier discount and blocks loyalty redemption.
export function resolveStacking(args: { couponStackable: boolean }): { allowTier: boolean; allowLoyalty: boolean } {
    return args.couponStackable ? { allowTier: true, allowLoyalty: true } : { allowTier: false, allowLoyalty: false };
}

/// One-shot finalizer shared by /api/pos/sale and /api/pos/coupon-validate so the
/// validated ₹ and the posted ₹ are identical. Applies stacking (drops tier /
/// blocks loyalty when the coupon isn't stackable), a hard ceiling so the
/// post-discount bill stays > 0, and the global discount-% guard.
export function finalizeCouponAmount(args: {
    selectedDiscount: number; // coupon-alone ₹ from computeCouponDiscount
    tierRupees: number;
    loyaltyRupees: number;
    goodsValue: number;
    couponStackable: boolean;
    maxTotalDiscountPct: number | null;
}): { couponRupees: number; effTier: number; effLoyalty: number; droppedTier: boolean; blockedLoyalty: boolean; clampedByGuard: boolean } {
    const { selectedDiscount, tierRupees, loyaltyRupees, goodsValue, couponStackable, maxTotalDiscountPct } = args;
    const { allowTier, allowLoyalty } = resolveStacking({ couponStackable });
    const effTier = allowTier ? tierRupees : 0;
    const effLoyalty = allowLoyalty ? loyaltyRupees : 0;
    // Keep goods − tier − loyalty − coupon strictly > 0.
    const ceiling = Math.max(0, goodsValue - effTier - effLoyalty - 0.01);
    const guard = applyGlobalDiscountGuard({
        couponRupees: Math.min(selectedDiscount, ceiling),
        tierRupees: effTier, loyaltyRupees: effLoyalty, billGoods: goodsValue, maxTotalDiscountPct,
    });
    return {
        couponRupees: r2(guard.couponRupees),
        effTier, effLoyalty,
        droppedTier: !allowTier && tierRupees > 0,
        blockedLoyalty: !allowLoyalty && loyaltyRupees > 0,
        clampedByGuard: guard.clamped,
    };
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
