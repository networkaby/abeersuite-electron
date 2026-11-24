// Unit tests: loyalty earn / redeem maths. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildRulesIndex, resolveEarnMultiplier, earnableBaseForCart, redeemableBaseForCart,
    resolveRedeemCapPct, pointsForBase, clampRedemption, expiryCutoff, type LoyaltyRates, type TaxonomyMaps,
} from "./loyaltyMath";

const RATES: LoyaltyRates = {
    enabled: true, earnEnabled: true, redeemEnabled: true, globalEarnRatePer: 100, redeemValue: 1,
    expiryEnabled: false, expiryDays: 0, minEarnInvoiceValue: null, minRedeemInvoiceValue: null,
    minRedeemPoints: null, maxRedeemPctOfBill: null,
};
// Group 2's parent is group 1; category 20's parent is category 10.
const MAPS: TaxonomyMaps = { groupParent: new Map([[2, 1], [1, null]]), categoryParent: new Map([[20, 10], [10, null]]) };
const rule = (o: Partial<Parameters<typeof buildRulesIndex>[0][number]>) =>
    ({ scope: "PRODUCT" as const, categoryId: null, groupId: null, productId: null, multiplier: 1, redeemCapPct: null, enabled: true, ...o });

test("earn multiplier: product beats group beats category; parents are walked", () => {
    const idx = buildRulesIndex([
        rule({ scope: "PRODUCT", productId: 7, multiplier: 3 }),
        rule({ scope: "GROUP", groupId: 1, multiplier: 2 }),
        rule({ scope: "CATEGORY", categoryId: 10, multiplier: 1.5 }),
    ]);
    assert.equal(resolveEarnMultiplier({ productId: 7, groupId: 2, categoryId: 20 }, idx, MAPS), 3);
    assert.equal(resolveEarnMultiplier({ productId: 8, groupId: 2, categoryId: 20 }, idx, MAPS), 2); // via parent group 1
    assert.equal(resolveEarnMultiplier({ productId: 8, groupId: null, categoryId: 20 }, idx, MAPS), 1.5); // via parent cat 10
    assert.equal(resolveEarnMultiplier({ productId: 8, groupId: null, categoryId: null }, idx, MAPS), 1);
});

test("disabled rules are ignored", () => {
    const idx = buildRulesIndex([rule({ productId: 7, multiplier: 5, enabled: false })]);
    assert.equal(resolveEarnMultiplier({ productId: 7, groupId: null, categoryId: null }, idx, MAPS), 1);
});

test("a loop in the group tree does not hang", () => {
    const loop: TaxonomyMaps = { groupParent: new Map([[1, 2], [2, 1]]), categoryParent: new Map() };
    assert.equal(resolveEarnMultiplier({ productId: 1, groupId: 1, categoryId: null }, buildRulesIndex([]), loop), 1);
});

test("earn base: discount shared by line value, then multiplied", () => {
    const idx = buildRulesIndex([rule({ productId: 1, multiplier: 2 })]);
    const lines = [
        { productId: 1, groupId: null, categoryId: null, goods: 600 },
        { productId: 2, groupId: null, categoryId: null, goods: 400 },
    ];
    // ₹100 off: line1 600-60=540 ×2 = 1080, line2 400-40=360 ×1 -> 1440
    assert.equal(earnableBaseForCart(lines, 100, idx, MAPS), 1440);
    assert.equal(earnableBaseForCart([], 100, idx, MAPS), 0);
});

test("points: whole points only; switched off -> 0", () => {
    assert.equal(pointsForBase(1440, RATES), 14);
    assert.equal(pointsForBase(99, RATES), 0);
    assert.equal(pointsForBase(1440, { ...RATES, earnEnabled: false }), 0);
});

test("redeem cap: item rule, else global cap, else whole line", () => {
    const idx = buildRulesIndex([rule({ productId: 1, redeemCapPct: 10 })]);
    assert.equal(resolveRedeemCapPct({ productId: 1, groupId: null, categoryId: null }, idx, MAPS, 50), 10);
    assert.equal(resolveRedeemCapPct({ productId: 2, groupId: null, categoryId: null }, idx, MAPS, 50), 50);
    assert.equal(resolveRedeemCapPct({ productId: 2, groupId: null, categoryId: null }, idx, MAPS, null), null);
    const lines = [{ productId: 1, groupId: null, categoryId: null, goods: 1000 }, { productId: 2, groupId: null, categoryId: null, goods: 1000 }];
    assert.equal(redeemableBaseForCart(lines, 0, idx, MAPS, null), 100 + 1000);
});

test("clampRedemption: the reasons a redemption is refused", () => {
    assert.deepEqual(clampRedemption(100, 500, 1000, 2000, RATES), { points: 100, value: 100 });
    assert.match(clampRedemption(600, 500, 1000, 2000, RATES).reason!, /only 500 available/);
    assert.match(clampRedemption(100, 500, 1000, 200, { ...RATES, minRedeemInvoiceValue: 500 }).reason!, /at least/);
    assert.match(clampRedemption(10, 500, 1000, 2000, { ...RATES, minRedeemPoints: 50 }).reason!, /Minimum 50/);
    assert.match(clampRedemption(100, 500, 50, 2000, RATES).reason!, /exceeds/);
    assert.deepEqual(clampRedemption(100, 500, 1000, 2000, { ...RATES, redeemEnabled: false }), { points: 0, value: 0 });
});

test("expiry cut-off: off -> null, else now minus days", () => {
    assert.equal(expiryCutoff(new Date("2026-11-24T00:00:00Z"), { expiryEnabled: false, expiryDays: 30 }), null);
    const c = expiryCutoff(new Date("2026-11-24T12:00:00Z"), { expiryEnabled: true, expiryDays: 30 })!;
    assert.equal(Math.round((new Date("2026-11-24T12:00:00Z").getTime() - c.getTime()) / 86_400_000), 30);
});
