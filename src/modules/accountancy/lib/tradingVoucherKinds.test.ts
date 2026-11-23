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
