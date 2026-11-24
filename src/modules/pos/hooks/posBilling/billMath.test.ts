// Unit tests: POS screen bill maths (billMath.ts). Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineFloorExcl, lineHeadroom, loyaltyRedemption } from "./billMath";
import type { CartLine, Snapshot } from "@/modules/pos/lib/posDraftTypes";

const line = (o: Partial<CartLine>): CartLine =>
    ({ productId: 1, sku: "S", name: "N", qty: 1, unitPrice: 100, description: "", taxRate: 0, ...o }) as CartLine;

const RATES: NonNullable<Snapshot["loyaltyRates"]> = {
    enabled: true, earnEnabled: true, redeemEnabled: true, globalEarnRatePer: 100, redeemValue: 1,
    expiryEnabled: false, expiryDays: 0, minEarnInvoiceValue: null, minRedeemInvoiceValue: null,
    minRedeemPoints: null, maxRedeemPctOfBill: null,
};

const loyalty = (o: Partial<Parameters<typeof loyaltyRedemption>[0]> = {}) => {
    const cart = o.cart ?? [line({ qty: 1, unitPrice: 1000 })];
    return loyaltyRedemption({
        eb: null,
        snapshot: { loyaltyRates: RATES, loyaltyPoints: 500 },
        cart,
        lineRows: cart.map((l) => ({ amount: l.qty * l.unitPrice, taxAmount: 0, gross: l.qty * l.unitPrice })),
        shippingAmt: 0, discountAmount: 0, manualChargesNet: 0, floorRoom: Infinity,
        editLinesUnchanged: false, redeemOn: true, redeemPointsStr: "200",
        lineProtected: (l) => !!l.protected,
        ...o,
    });
};

test("lineFloorExcl: sale price backed out of GST; service and no price -> null", () => {
    assert.equal(lineFloorExcl(line({ salePaise: 11800, taxRate: 18 })), 100);
    assert.equal(lineFloorExcl(line({ salePaise: 5000 })), 50);
    assert.equal(lineFloorExcl(line({ salePaise: null })), null);
    assert.equal(lineFloorExcl(line({ kind: "service", salePaise: 5000 })), null);
});

test("loyalty: asks 200 of 500 points on a ₹1000 bill -> 200 pts, ₹200", () => {
    const r = loyalty();
    assert.equal(r.redeemPts, 200);
    assert.equal(r.redemptionRupees, 200);
});

test("loyalty: never more than the balance", () => {
    assert.equal(loyalty({ redeemPointsStr: "900" }).redeemPts, 500);
});

test("loyalty: bill cap % limits the points", () => {
    const r = loyalty({ snapshot: { loyaltyRates: { ...RATES, maxRedeemPctOfBill: 10 }, loyaltyPoints: 500 } });
    assert.equal(r.maxRedeemablePts, 100);
    assert.equal(r.redeemPts, 100);
});

test("loyalty: protected and service lines are outside the base", () => {
    const r = loyalty({ cart: [line({ unitPrice: 1000, protected: true }), line({ productId: -1, kind: "service", unitPrice: 500 })] });
    assert.equal(r.redeemPts, 0);
});

test("loyalty: below the min bill, or switched off -> 0", () => {
    assert.equal(loyalty({ snapshot: { loyaltyRates: { ...RATES, minRedeemInvoiceValue: 5000 }, loyaltyPoints: 500 } }).redeemPts, 0);
    assert.equal(loyalty({ redeemOn: false }).redeemPts, 0);
    assert.equal(loyalty({ snapshot: { loyaltyRates: { ...RATES, redeemEnabled: false }, loyaltyPoints: 500 } }).redeemPts, 0);
});

test("loyalty: under min points -> 0", () => {
    assert.equal(loyalty({ snapshot: { loyaltyRates: { ...RATES, minRedeemPoints: 300 }, loyaltyPoints: 500 } }).redeemPts, 0);
});

test("loyalty: the lowest-price wall limits the points", () => {
    assert.equal(loyalty({ floorRoom: 50 }).redeemPts, 50);
});

test("headroom: room above the sale price, per piece and in total", () => {
    // 2 pcs at ₹120 with a ₹100 floor (no GST) -> ₹40 room; ₹10 bill-wide cut
    const l = line({ qty: 2, unitPrice: 120, salePaise: 10000 });
    const r = lineHeadroom([l], [0], 10);
    assert.equal(r.lineGapRupees.get(l), 15);
    assert.equal(r.totalGapRupees, 30);
});

test("headroom: no floor anywhere -> no hint", () => {
    const r = lineHeadroom([line({})], [0], 0);
    assert.equal(r.totalGapRupees, null);
    assert.equal(r.lineGapRupees.size, 0);
});
