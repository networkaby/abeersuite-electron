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
    /// FREE_ITEM / BOGO only — an independent FREE-GRANT coupon: applies ON TOP
    /// of the money coupon (never drops tier / blocks loyalty / hits the guard)
    /// and grants its item(s) as zero-price lines instead of a ₹ discount.
    independent: boolean;
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
    /// Unit COST incl. tax (rupees) — NOT the %-coupon base anymore (PERCENT
    /// coupons discount the eligible SALE value, so the ₹ off can never hint
    /// at the cost — cost is a business secret). Kept only for coupon-validate's
    /// LINE-scope tier-share estimate, because the spend-tier discount itself
    /// is still % of cost. null/absent = no cost basis.
    costIncl?: number | null;
    /// Discount-protected (ProductProtection blacklist) — the line is excluded
    /// from every automatic promotion: it never matches a coupon's rules
    /// (eligible subtotal / % base / SET_PRICE) and item-targeted coupons
    /// (FREE_ITEM / BOGO) refuse to give it away. True only when the caller
    /// loaded the blacklist; absent/false = no protection.
    protected?: boolean;
}

export interface EvalInput {
    accountId: number | null;
    lines: CartLineLite[];
    /// Σ line goods (pre-tax, pre-discount) — basis for min-bill + eligible subtotal.
    goodsValue: number;
    /// Tax-inclusive voucher bill amount — goods (incl. GST) + shipping + charges
    /// + services − tier discount + round-off, before the money coupon / loyalty
    /// redemption — the min-bill qualifier for FREE-GRANT coupons (a ₹1,200 bill
    /// with ₹300 shipping qualifies where goods alone wouldn't, and a deep
    /// discount pulls it below). Absent/undefined = the free-grant gate falls
    /// back to `goodsValue`.
    billAmountIncl?: number;
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
        // Discount-protected lines are never touched by any coupon.
        if (line.protected) return false;
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

/// Σ COST (incl. tax) of the eligible lines — kept for coupon-validate's
/// LINE-scope exclusivity estimate (the coupon's matched-line share of the
/// TIER's cost base, since the tier discount is still % of cost). NOT used by
/// the coupon discount itself — PERCENT coupons are a % of the sale value.
/// Lines with no cost basis add 0.
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
    const g = commonEligibilityGates(c, input);
    if (!g.ok) return g;
    if (eligibleSubtotal(c, input.lines) <= 0) return { ok: false, reason: "No eligible items in the cart" };
    return { ok: true };
}

/// The gates shared by every coupon flavour: active, window, min-bill,
/// eligibility, owner. The money-coupon gate adds "applies to at least one
/// line" on top; the free-grant gate deliberately does NOT — an independent
/// FREE_ITEM / BOGO coupon ADDS its item to the bill, so an empty match set is
/// expected (min-bill still qualifies the cart as a whole).
function commonEligibilityGates(c: CouponContext, input: EvalInput): { ok: true } | EvalFail {
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
    return { ok: true };
}

/// Free-grant gate (independent FREE_ITEM / BOGO): the shared gates only — no
/// "applies to at least one line" check, because the coupon grants its own
/// line. The buy-side of a BOGO is checked by `freeGrantForCoupon` (it needs
/// the cart to unlock the free units). Pure — usage limits need the DB.
///
/// Min-bill: the free item qualifies on the VOUCHER TOTAL — the tax-inclusive
/// bill the customer pays (all +/− adjustments folded in), per `billAmountIncl`
/// — never on raw pre-tax goods alone. Money coupons keep the goods basis (a
/// coupon reducing its own bill would be circular).
export function checkFreeGrantEligibility(c: CouponContext, input: EvalInput): { ok: true } | EvalFail {
    return commonEligibilityGates(c, input.billAmountIncl != null ? { ...input, goodsValue: input.billAmountIncl } : input);
}

/// FREE_ITEM / BOGO coupon whose item is given away fully (freeDiscountPct ≥
/// 99.5) — the "fully free" predicate, independent of the Independent toggle.
/// A fully-free coupon GRANTS its item (zero-price lines) instead of a ₹
/// discount, whether it rides the on-top slot (rule 1) or wins the money slot
/// (rule 3).
export function isFullyFreeItem(c: Pick<CouponContext, "type" | "freeDiscountPct">): boolean {
    return (c.type === "FREE_ITEM" || c.type === "BOGO") && (c.freeDiscountPct ?? 100) >= 99.5;
}

/// An INDEPENDENT FREE_ITEM / BOGO coupon (any %): the "on-top" family. It
/// never competes for the money slot and never drops tier / blocks loyalty /
/// hits the guard — it rides on top of the money coupon and every other
/// discount. Fully free → grants its item as zero-price lines (the item is
/// auto-added). Not fully free → discounts its item by freeDiscountPct once
/// that item is in the cart.
export function isIndependentFreeItem(c: Pick<CouponContext, "type" | "independent">): boolean {
    return c.independent && (c.type === "FREE_ITEM" || c.type === "BOGO");
}

/// Is this an independent FREE-GRANT coupon (independent FREE_ITEM / BOGO that
/// is FULLY free)? Only these add free lines on top of the money coupon, and
/// the grant fires the moment the cart qualifies (its item does NOT need to be
/// in the cart). An independent coupon that is NOT fully free is a PARTIAL
/// on-top discount instead — its item must be in the cart.
export function isFreeGrantCoupon(c: Pick<CouponContext, "type" | "independent" | "freeDiscountPct">): boolean {
    return isIndependentFreeItem(c) && isFullyFreeItem(c);
}

/// A NON-independent fully-free FREE_ITEM / BOGO coupon — rule 3. It competes
/// for the single money slot like any money coupon; when it WINS, its item is
/// granted as zero-price lines (auto-added, need not be in the cart) with
/// money-slot semantics (exclusivity mask applies).
export function isMoneyGrantCoupon(c: Pick<CouponContext, "type" | "independent" | "freeDiscountPct">): boolean {
    return !c.independent && isFullyFreeItem(c);
}

/// The free units an independent FREE_ITEM / BOGO coupon grants on the current
/// cart: { productId, freeQty }. null = the offer can't fire right now:
///   • FREE_ITEM — always grants `freeQty` (1 default) of the offer item; the
///     item does NOT need to be in the cart (the coupon adds it).
///   • BOGO      — every buyQty units of the buy item (any item when no buy
///     product is set) unlock getQty of the get item — straight 1:1 compounding:
///     "Buy 1 get 1 FREE" = 12 bought → 12 free. Null when nothing is unlocked
///     yet. (A buyQty of 2 with getQty 1 is the "Buy 2 get 1" case.)
/// Discount-protection is NOT checked here — callers pass the blacklist.
export function freeGrantForCoupon(c: CouponContext, lines: CartLineLite[]): { productId: number; freeQty: number } | null {
    if (c.type === "FREE_ITEM") {
        if (c.freeProductId == null) return null;
        return { productId: c.freeProductId, freeQty: Math.max(1, Math.floor(c.freeQty ?? 1)) };
    }
    if (c.type === "BOGO") {
        const getProductId = c.freeProductId ?? c.buyProductId;
        if (getProductId == null) return null;
        const buyQty = c.buyQty ?? 1;
        const getQty = c.getQty ?? 1;
        // Units that count toward the buy side: the buy product's qty, or the
        // WHOLE cart when the offer says "buy any item" (buyProductId null).
        const units = c.buyProductId != null
            ? (lines.find((l) => l.productId === c.buyProductId)?.qty ?? 0)
            : lines.reduce((s, l) => s + l.qty, 0);
        const freeUnits = Math.floor(units / buyQty) * getQty;
        if (freeUnits <= 0) return null;
        return { productId: getProductId, freeQty: freeUnits };
    }
    return null;
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
            // % of the eligible SALE value (pre-tax) — the price the customer
            // sees. Cost never enters the math, so the ₹ off can never hint at
            // the cost / margin (a business secret). Clamped to the eligible
            // subtotal so a line can't be discounted below zero.
            raw = Math.min(elig * (c.percentOff / 100), elig);
            if (c.maxDiscountAmt != null) raw = Math.min(raw, c.maxDiscountAmt);
            break;
        }
        case "FLAT": {
            if (c.flatAmt == null) return { ok: false, reason: "Coupon misconfigured (no amount)" };
            raw = Math.min(c.flatAmt, elig);
            break;
        }
        case "FREE_ITEM":
        case "BOGO": {
            const r = itemDiscountRaw(c, input);
            if (!r.ok) return r;
            raw = r.raw;
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

/// The FREE_ITEM / BOGO item-based discount — raw ₹, pre-clamp. The offer's
/// item already in the cart, discounted by freeDiscountPct (100 = free) for up
/// to freeQty units. Shared by the money slot (rule 4: computeCouponDiscount)
/// and the on-top slot (rule 2: computeOnTopPartial) so both show the SAME ₹.
function itemDiscountRaw(c: CouponContext, input: EvalInput): { ok: true; raw: number } | EvalFail {
    if (c.type === "FREE_ITEM") {
        // Discount a specific item already in the cart by freeDiscountPct
        // (100 = free) for up to freeQty units. Rides the same whole-bill
        // negative-charge path — no extra cart line is added.
        if (c.freeProductId == null) return { ok: false, reason: "Coupon misconfigured (no item)" };
        const line = input.lines.find((l) => l.productId === c.freeProductId);
        if (!line) return { ok: false, reason: "Add the offer item to the cart" };
        if (line.protected) return { ok: false, reason: "Coupon is not applicable on this bill" };
        const qty = Math.min(c.freeQty ?? 1, line.qty);
        const pctOff = c.freeDiscountPct ?? 100;
        return { ok: true, raw: qty * line.unitPrice * (pctOff / 100) };
    }
    if (c.type === "BOGO") {
        // Buy X get Y. Get-item = freeProductId (or the buy item for same-item
        // BOGO). The get units are discounted by freeDiscountPct (100 = free).
        const buyQty = c.buyQty ?? 1;
        const getQty = c.getQty ?? 1;
        const getProductId = c.freeProductId ?? c.buyProductId;
        if (getProductId == null) return { ok: false, reason: "Coupon misconfigured (no item)" };
        const getLine = input.lines.find((l) => l.productId === getProductId);
        if (!getLine) return { ok: false, reason: "Add the offer item to the cart" };
        if (getLine.protected) return { ok: false, reason: "Coupon is not applicable on this bill" };
        const pctOff = c.freeDiscountPct ?? 100;
        const sameItem = c.buyProductId == null || c.freeProductId == null || c.freeProductId === c.buyProductId;
        // A protected BUY item can't unlock the offer either (same-item BOGO
        // is already covered by the get-line check above).
        if (!sameItem && c.buyProductId != null) {
            const buyLine = input.lines.find((l) => l.productId === c.buyProductId);
            if (buyLine?.protected) return { ok: false, reason: "Coupon is not applicable on this bill" };
        }
        // Straight 1:1 compounding — every buyQty units unlock getQty free
        // ("Buy 1 get 1 FREE" = 12 bought → 12 free). Buy-any (no buy product)
        // counts the whole cart. Mirrors freeGrantForCoupon so the validated
        // ₹ and the posted ₹ stay identical.
        const units = c.buyProductId != null
            ? (input.lines.find((l) => l.productId === c.buyProductId)?.qty ?? 0)
            : input.lines.reduce((s, l) => s + l.qty, 0);
        let freeUnits = Math.floor(units / buyQty) * getQty;
        freeUnits = Math.min(freeUnits, getLine.qty);
        if (freeUnits <= 0) return { ok: false, reason: "Buy more to unlock the offer" };
        return { ok: true, raw: freeUnits * getLine.unitPrice * (pctOff / 100) };
    }
    return { ok: false, reason: "Coupon misconfigured" };
}

/// Rule 2 — an INDEPENDENT PARTIAL (<100%) FREE_ITEM / BOGO coupon: discounts
/// its item by freeDiscountPct ONCE that item is in the cart, ON TOP of the
/// money coupon, tier, and loyalty. Never competes for the money slot, never
/// drops tier / blocks loyalty, never hits the global guard. Gates are the
/// on-top family's (common gates; min-bill on the voucher total when provided)
/// — the item-in-cart requirement is the discount's own gate below.
export function computeOnTopPartial(c: CouponContext, input: EvalInput): EvalResult {
    const gate = checkFreeGrantEligibility(c, input);
    if (!gate.ok) return gate;
    const r = itemDiscountRaw(c, input);
    if (!r.ok) return r;
    // Never drive the bill to ≤ 0 (same ceiling as the money coupon).
    const ceiling = Math.max(0, input.billBeforeCoupon - 0.01);
    const discount = r2(Math.min(r.raw, ceiling));
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
