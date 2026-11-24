// Unit tests: the bill-entry line maths (screen side). Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcLine, exclusiveRate, newLine, reprice } from "./tradingVoucherKinds";
import { calcLineTotals } from "@/modules/inventory/lib/voucherMath";

const line = (o: Partial<ReturnType<typeof newLine>>) => ({ ...newLine(), ...o });

test("exclusiveRate takes GST out only in incl mode", () => {
    assert.equal(exclusiveRate({ rate: "118", taxRate: "18" }, true), 100);
    assert.equal(exclusiveRate({ rate: "118", taxRate: "18" }, false), 118);
    assert.equal(exclusiveRate({ rate: "", taxRate: "18" }, true), 0);
});

test("incl-price discount bug stays fixed: ₹118 incl 18%, 10% off -> ₹106.20", () => {
    const l = reprice(line({ quantity: "1", rate: "118", taxRate: "18", discountPct: "10" }), true);
    assert.equal(l.discountAmt, "10.00");
    assert.equal(l.taxAmount, "16.20");
    assert.equal(calcLine(l, { rateInclTax: true }).amount, 106.2);
});

test("blank fields count as 0, not NaN", () => {
    assert.equal(calcLine(newLine()).amount, 0);
});

test("screen total matches the server total for the same line", () => {
    const l = reprice(line({ quantity: "3", rate: "249.99", taxRate: "18", discountPct: "7" }), false);
    const screen = calcLine(l).amount;
    const server = calcLineTotals({ quantity: 3, rate: 249.99, discountPct: 7, discountAmt: 0, taxRate: 18 }).amount;
    assert.equal(screen, server);
});

// ── Paired-field editors (moved out of TradingVoucherPage.tsx) ──────────────
import { withDiscountPct, withDiscountAmt, withTaxAmount, withLineAmount, withTaxFromRate } from "./tradingVoucherKinds";

test("discount %: 2 x ₹100 at 18%, 10% off -> ₹20 off, tax ₹32.40", () => {
    const l = withDiscountPct(line({ quantity: "2", rate: "100", taxRate: "18" }), "10", false);
    assert.equal(l.discountAmt, "20.00");
    assert.equal(l.taxAmount, "32.40");
});

test("discount ₹: ₹20 off ₹200 -> 10%", () => {
    const l = withDiscountAmt(line({ quantity: "2", rate: "100", taxRate: "18" }), "20", false);
    assert.equal(l.discountPct, "10.00");
    assert.equal(l.taxAmount, "32.40");
});

test("zero results stay blank, not 0.00", () => {
    const l = withDiscountPct(line({ quantity: "1", rate: "100" }), "0", false);
    assert.equal(l.discountAmt, "");
    assert.equal(withTaxFromRate(line({ quantity: "1", rate: "100" }), false).taxAmount, "");
});

test("tax ₹ typed solves the GST % (excl and incl price)", () => {
    assert.equal(withTaxAmount(line({ quantity: "1", rate: "100" }), "18", false).taxRate, "18.00");
    // ₹118 incl, ₹18 tax -> 18%
    assert.equal(withTaxAmount(line({ quantity: "1", rate: "118" }), "18", true).taxRate, "18.00");
});

test("amount typed solves the rate: ₹236 for 2 at 18% -> ₹100 each", () => {
    const l = withLineAmount(line({ quantity: "2", taxRate: "18" }), "236", false);
    assert.equal(l.rate, "100");
    assert.equal(l.taxAmount, "36.00");
    assert.equal(withLineAmount(line({ quantity: "2", taxRate: "18" }), "236", true).rate, "118");
});
