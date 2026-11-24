// Unit tests: coupon maths. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCouponDiscount, finalizeCouponAmount, applyGlobalDiscountGuard, couponExclusionMask, linesMatchedByRules, type CouponContext, type EvalInput, type CartLineLite } from "./couponMath";

const NOW = new Date("2026-11-24T06:00:00Z");
const coupon = (o: Partial<CouponContext>): CouponContext => ({
    id: 1, code: "SAVE", name: "Save", type: "PERCENT", channels: "BOTH", applyMode: "CODE",
    percentOff: 10, maxDiscountAmt: null, flatAmt: null, freeProductId: null, freeQty: null, freeDiscountPct: null,
    buyProductId: null, buyQty: null, getQty: null, setPriceAmt: null, startsAt: null, endsAt: null,
    minBillValue: null, eligibility: "ANY", stackable: true, stackScope: "BILL", independent: false,
    ownerAccountId: null, isActive: true, totalUsageLimit: null, perCustomerLimit: null, isPrivate: false, rules: [], ...o,
});
const line = (o: Partial<CartLineLite>): CartLineLite => ({ productId: 1, groupId: null, categoryId: null, brandId: 5, qty: 1, unitPrice: 1000, ...o });
const input = (lines: CartLineLite[], o: Partial<EvalInput> = {}): EvalInput => {
    const goods = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    return { accountId: 9, lines, goodsValue: goods, billBeforeCoupon: goods, isNewCustomer: false, now: NOW, ...o };
};
const ok = (r: ReturnType<typeof computeCouponDiscount>) => (r.ok ? r.discountRupees : r.reason);

test("PERCENT: % of eligible sale value, capped by max ₹", () => {
    assert.equal(ok(computeCouponDiscount(coupon({}), input([line({ unitPrice: 2000 })]))), 200);
    assert.equal(ok(computeCouponDiscount(coupon({ maxDiscountAmt: 150 }), input([line({ unitPrice: 2000 })]))), 150);
});

test("FLAT: never more than the eligible items", () => {
    assert.equal(ok(computeCouponDiscount(coupon({ type: "FLAT", flatAmt: 300 }), input([line({})]))), 300);
    assert.equal(ok(computeCouponDiscount(coupon({ type: "FLAT", flatAmt: 3000 }), input([line({})]))), 999.99); // bill stays > 0
});

test("INCLUDE / EXCLUDE rules pick the eligible lines", () => {
    const lines = [line({ productId: 1, brandId: 5 }), line({ productId: 2, brandId: 6 })];
    const onlyBrand5 = coupon({ rules: [{ kind: "INCLUDE", productId: null, categoryId: null, groupId: null, brandId: 5 }] });
    assert.equal(ok(computeCouponDiscount(onlyBrand5, input(lines))), 100);
    assert.deepEqual(linesMatchedByRules(onlyBrand5, lines), [true, false]);
    const notBrand5 = coupon({ rules: [{ kind: "EXCLUDE", productId: null, categoryId: null, groupId: null, brandId: 5 }] });
    assert.equal(ok(computeCouponDiscount(notBrand5, input(lines))), 100);
});

test("exclusivity: stackable keeps other discounts; LINE drops them on its own lines; BILL on all", () => {
    const lines = [line({ productId: 1, brandId: 5 }), line({ productId: 2, brandId: 6 })];
    const rules = [{ kind: "INCLUDE" as const, productId: null, categoryId: null, groupId: null, brandId: 5 }];
    assert.deepEqual(couponExclusionMask(coupon({ rules, stackable: true }), lines), [false, false]);
    assert.deepEqual(couponExclusionMask(coupon({ rules, stackable: false, stackScope: "LINE" }), lines), [true, false]);
    assert.deepEqual(couponExclusionMask(coupon({ rules, stackable: false, stackScope: "BILL" }), lines), [true, true]);
});

test("protected lines never get a coupon", () => {
    assert.equal(ok(computeCouponDiscount(coupon({}), input([line({ protected: true })]))), "No eligible items in the cart");
});

test("gates: inactive, not yet valid, expired, min bill, owner, new / returning", () => {
    const l = [line({})];
    assert.match(String(ok(computeCouponDiscount(coupon({ isActive: false }), input(l)))), /not active/);
    assert.match(String(ok(computeCouponDiscount(coupon({ startsAt: new Date("2026-12-01") }), input(l)))), /not yet valid/);
    assert.match(String(ok(computeCouponDiscount(coupon({ endsAt: new Date("2026-11-01") }), input(l)))), /expired/);
    assert.match(String(ok(computeCouponDiscount(coupon({ minBillValue: 5000 }), input(l)))), /Minimum bill/);
    assert.match(String(ok(computeCouponDiscount(coupon({ ownerAccountId: 3 }), input(l)))), /another customer/);
    assert.match(String(ok(computeCouponDiscount(coupon({ eligibility: "NEW" }), input(l)))), /first-time/);
    assert.match(String(ok(computeCouponDiscount(coupon({ eligibility: "RETURNING" }), input(l, { isNewCustomer: true })))), /returning/);
});

test("BOGO: buy 1 get 1 free, same item", () => {
    const c = coupon({ type: "BOGO", buyProductId: 1, buyQty: 1, getQty: 1, freeDiscountPct: 100 });
    // 4 bought -> 4 free, but never more than the line's own qty (4) -> ₹400 at ₹100
    assert.equal(ok(computeCouponDiscount(c, input([line({ qty: 4, unitPrice: 100 })]))), 399.99);
    assert.equal(ok(computeCouponDiscount(c, input([line({ qty: 2, unitPrice: 100 })], { billBeforeCoupon: 1000 }))), 200);
});

test("SET_PRICE: eligible units net down to the set price", () => {
    const c = coupon({ type: "SET_PRICE", setPriceAmt: 80 });
    assert.equal(ok(computeCouponDiscount(c, input([line({ qty: 3, unitPrice: 100 })]))), 60);
});

test("finalize: own cap, then the total guard, then the lowest-price wall", () => {
    assert.equal(finalizeCouponAmount({ selectedDiscount: 300, tierRupees: 0, loyaltyRupees: 0, goodsValue: 1000, maxTotalDiscountPct: null, maxCouponDiscountPct: 20 }).couponRupees, 200);
    const g = finalizeCouponAmount({ selectedDiscount: 300, tierRupees: 100, loyaltyRupees: 50, goodsValue: 1000, maxTotalDiscountPct: 25 });
    assert.deepEqual(g, { couponRupees: 100, clampedByGuard: true });
    assert.equal(finalizeCouponAmount({ selectedDiscount: 300, tierRupees: 0, loyaltyRupees: 0, goodsValue: 1000, maxTotalDiscountPct: null, floorRoomIncl: 120 }).couponRupees, 120);
});

test("global guard: no guard -> unchanged", () => {
    assert.deepEqual(applyGlobalDiscountGuard({ couponRupees: 500, tierRupees: 0, loyaltyRupees: 0, billGoods: 1000, maxTotalDiscountPct: null }), { couponRupees: 500, clamped: false });
});
