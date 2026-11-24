// Unit tests: credit limit. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAutoCreditLimit, creditLimitRefusal, type CreditLimitConfigLite } from "./creditLimit";

const CFG: CreditLimitConfigLite = { autoEnabled: true, windowDays: 90, pctOfSales: 20, maxAutoLimit: null, roundToStep: 0 };

test("auto limit = % of sales in the window", () => {
    assert.equal(computeAutoCreditLimit(50_000, CFG), 10_000);
});

test("auto limit: rounded to the step, then capped", () => {
    assert.equal(computeAutoCreditLimit(12_345, { ...CFG, roundToStep: 500 }), 2_500); // 2,469 -> 2,500
    assert.equal(computeAutoCreditLimit(1_000_000, { ...CFG, maxAutoLimit: 25_000 }), 25_000);
});

test("auto limit: off, no sales or 0% -> 0", () => {
    assert.equal(computeAutoCreditLimit(50_000, { ...CFG, autoEnabled: false }), 0);
    assert.equal(computeAutoCreditLimit(0, CFG), 0);
    assert.equal(computeAutoCreditLimit(50_000, { ...CFG, pctOfSales: 0 }), 0);
});

test("fully paid sale -> always allowed", () => {
    assert.equal(creditLimitRefusal({ limit: 0, balance: 5_000, onCredit: 0 }), null);
});

test("no credit facility (limit 0) -> refused", () => {
    assert.equal(creditLimitRefusal({ limit: 0, balance: 0, onCredit: 100 })?.code, "NO_CREDIT_ALLOWED");
});

test("an advance that covers the credit -> allowed even with limit 0", () => {
    assert.equal(creditLimitRefusal({ limit: 0, balance: -1_000, onCredit: 800 }), null);
    assert.equal(creditLimitRefusal({ limit: 0, balance: -1_000, onCredit: 1_000 }), null);
    assert.equal(creditLimitRefusal({ limit: 0, balance: -1_000, onCredit: 1_000.5 })?.code, "NO_CREDIT_ALLOWED");
});

test("within the limit -> allowed; over -> refused with the figures", () => {
    assert.equal(creditLimitRefusal({ limit: 10_000, balance: 6_000, onCredit: 4_000 }), null);
    const r = creditLimitRefusal({ limit: 10_000, balance: 6_000, onCredit: 4_001 });
    assert.equal(r?.code, "CREDIT_LIMIT_EXCEEDED");
    assert.match(r!.reason, /10,000/);
    assert.match(r!.reason, /6,000/);
});
