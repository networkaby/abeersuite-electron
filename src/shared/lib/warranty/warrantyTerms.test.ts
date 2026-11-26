// Unit tests: warranty term labels and the bill's Warranty section. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWarrantyGroups, checkWarrantyShape, formatWarrantyDays, warrantyPrintChanged, warrantyTermLabel } from "./warrantyTerms";

const mfr1 = { durationDays: 365, warrantyType: "MANUFACTURER" };
const mfr3 = { durationDays: 1096, warrantyType: "MANUFACTURER" };
const comb = { durationDays: 730, warrantyType: "COMBINED", sellerDays: 365 };
const none = { durationDays: null, warrantyType: "NONE" };
const texts = { warrantyManufacturerText: "Claim at the brand centre.", warrantyCombinedText: "Shop first.", warrantySellerText: "Bring to shop." };

test("groups by type + condition, never by duration; lines without a term are skipped", () => {
    // The owner's example: 1,3,4 one type · 2,5 another · 6,7 none · 8 not mentioned.
    const g = buildWarrantyGroups([mfr1, comb, mfr3, mfr1, comb, none, none, null], texts);
    assert.deepEqual(g.map((x) => x.items), [[1, 3, 4], [2, 5], [6, 7]]);
    assert.equal(g[0].label, "Manufacturer warranty");
    assert.equal(g[0].condition, "Claim at the brand centre.");
    assert.equal(g[1].label, "Seller warranty for the first 1 year, then manufacturer");
    assert.equal(g[2].label, "No warranty");
});

test("a term's extra condition splits it into its own group", () => {
    const g = buildWarrantyGroups([mfr1, { ...mfr1, extraCondition: "Battery 6 months." }], texts);
    assert.equal(g.length, 2);
    assert.equal(g[1].condition, "Claim at the brand centre. Battery 6 months.");
});

test("no term on any line → no section", () => {
    assert.deepEqual(buildWarrantyGroups([null, undefined], texts), []);
});

test("day counts round over leap days", () => {
    assert.deepEqual([7, 90, 180, 365, 730, 1096, 1826, 45].map(formatWarrantyDays), ["7d", "3m", "6m", "1y", "2y", "3y", "5y", "45d"]);
    assert.equal(warrantyTermLabel(comb), "1y seller + 2y mfr");
    assert.equal(warrantyTermLabel(none), "No warranty");
});

test("shape: combined needs a shorter seller part; none keeps no days", () => {
    assert.ok("error" in checkWarrantyShape({ warrantyType: "COMBINED", durationDays: 365, sellerDays: 365 }));
    assert.ok("error" in checkWarrantyShape({ warrantyType: "COMBINED", durationDays: 730, sellerDays: null }));
    assert.deepEqual(checkWarrantyShape({ warrantyType: "NONE", durationDays: 30, sellerDays: 5 }), { value: { warrantyType: "NONE", durationDays: null, sellerDays: null } });
    assert.deepEqual(checkWarrantyShape({ warrantyType: "SELLER", durationDays: 365, sellerDays: 30 }), { value: { warrantyType: "SELLER", durationDays: 365, sellerDays: null } });
});

test("printed-part change detection ignores blank vs null", () => {
    const a = { warrantyType: "SELLER", durationDays: 365, sellerDays: null, extraCondition: null };
    assert.equal(warrantyPrintChanged(a, { ...a, extraCondition: "  " }), false);
    assert.equal(warrantyPrintChanged(a, { ...a, durationDays: 730 }), true);
});
