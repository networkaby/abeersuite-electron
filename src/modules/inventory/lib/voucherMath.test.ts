// Unit tests: server-side bill maths. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcLineTotals, calcVoucherTotals, exactLineRate, resolveShippingGstRate } from "./voucherMath";

test("line: qty x rate, % discount, then GST", () => {
    // 2 x 100 = 200, 10% off = 20, taxable 180, 18% = 32.40
    assert.deepEqual(
        calcLineTotals({ quantity: 2, rate: 100, discountPct: 10, discountAmt: 0, taxRate: 18 }),
        { discountAmt: 20, taxAmount: 32.4, amount: 212.4 },
    );
});

test("line: a typed ₹ discount wins over %", () => {
    const r = calcLineTotals({ quantity: 1, rate: 100, discountPct: 50, discountAmt: 5, taxRate: 0 });
    assert.equal(r.discountAmt, 5);
    assert.equal(r.amount, 95);
});

test("line: GST-inclusive price ₹2100 @18% comes back to ₹2100", () => {
    const r = calcLineTotals({ quantity: 1, rate: 2100 / 1.18, discountPct: 0, discountAmt: 0, taxRate: 18 });
    assert.equal(r.amount, 2100);
});

test("voucher totals: shipping, discount, round-off, charges", () => {
    const t = calcVoucherTotals([{ amount: 212.4, taxAmount: 32.4 }, { amount: 95, taxAmount: 0 }], 50, 7.4, 0, 10);
    assert.deepEqual(t, { subtotal: 307.4, taxAmount: 32.4, totalAmount: 360 });
});

test("exactLineRate rebuilds the unrounded rate from the saved amount", () => {
    // 60 x ₹20 incl 18% -> saved amount 1200
    const rate = exactLineRate({ quantity: 60, rate: 16.95, amount: 1200, taxRate: 18 });
    const back = calcLineTotals({ quantity: 60, rate, discountPct: 0, discountAmt: 0, taxRate: 18 });
    assert.equal(back.amount, 1200);
    assert.equal(exactLineRate({ quantity: 0, rate: 16.95, amount: 0, taxRate: 18 }), 16.95);
});

test("shipping GST: >50% group wins, else the highest rate", () => {
    assert.equal(resolveShippingGstRate([]), 0);
    assert.equal(resolveShippingGstRate([{ value: 600, taxRate: 5 }, { value: 400, taxRate: 18 }]), 5);
    assert.equal(resolveShippingGstRate([{ value: 500, taxRate: 5 }, { value: 500, taxRate: 18 }]), 18);
});
