// Unit tests: Update & print labels price maths. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceWithMargin, marginFromPrice, shortDate, numOrNull, inRange, codeFromEnum, enumFromCode } from "./labelRowMath";

test("price = cost × (1 + margin%)", () => {
    assert.equal(priceWithMargin("100", "25"), 125);
    assert.equal(priceWithMargin("", "25"), null);
    assert.equal(priceWithMargin("-1", "25"), null);
    assert.equal(priceWithMargin("100", "x"), null);
});

test("margin back from price, 2 decimals; no cost -> blank", () => {
    assert.equal(marginFromPrice("80", "100"), "25");
    assert.equal(marginFromPrice("300", "400"), "33.33");
    assert.equal(marginFromPrice("0", "100"), "");
    assert.equal(marginFromPrice("80", ""), "");
});

test("short date: 2026-11-02 -> 2 Nov 26; bad -> blank", () => {
    assert.equal(shortDate("2026-11-02"), "2 Nov 26");
    assert.equal(shortDate(""), "");
});

test("number boxes: blank -> null; range limits are inclusive", () => {
    assert.equal(numOrNull(""), null);
    assert.equal(numOrNull("12.5"), 12.5);
    assert.ok(inRange(5, 5, 10));
    assert.ok(!inRange(11, 5, 10));
    assert.ok(inRange(5, null, null));
});

test("cost method code <-> enum, unknown -> weighted average", () => {
    assert.equal(codeFromEnum("FIFO"), "FO");
    assert.equal(codeFromEnum(null), "WA");
    assert.equal(enumFromCode("LI"), "LAST_INWARD");
});
