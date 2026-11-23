// Unit tests: rupee / paise helpers. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { round2, paiseToRupees, rupeesToPaise, parseRupeesToPaise } from "./moneyInr";

test("round2 rounds to paise without float drift", () => {
    assert.equal(round2(0.1 + 0.2), 0.3);
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(-2.345), -2.34);
    assert.equal(round2(1779.661016), 1779.66);
});

test("paise <-> rupees", () => {
    assert.equal(paiseToRupees(19900), 199);
    assert.equal(paiseToRupees(1), 0.01);
    assert.equal(rupeesToPaise(199.99), 19999);
    assert.equal(rupeesToPaise(0.1 + 0.2), 30);
});

test("parseRupeesToPaise: blank / bad / negative -> null, 0 stays 0", () => {
    assert.equal(parseRupeesToPaise(""), null);
    assert.equal(parseRupeesToPaise("  "), null);
    assert.equal(parseRupeesToPaise("abc"), null);
    assert.equal(parseRupeesToPaise("-5"), null);
    assert.equal(parseRupeesToPaise("0"), 0);
    assert.equal(parseRupeesToPaise(" 12.50 "), 1250);
});
