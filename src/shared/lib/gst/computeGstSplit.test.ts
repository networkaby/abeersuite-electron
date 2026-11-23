// Unit tests: CGST / SGST / IGST split. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGstSplit, isInterState, gstinDerivedStateCode } from "./computeGstSplit";

test("same state -> CGST + SGST, halves add back exactly", () => {
    const s = computeGstSplit({ taxAmount: 18, sellerStateCode: "27", buyerStateCode: "27" });
    assert.equal(s.kind, "INTRA");
    assert.equal(s.cgst, 9);
    assert.equal(s.sgst, 9);
    assert.equal(s.igst, 0);
});

test("odd paise: CGST + SGST still add up to the tax exactly", () => {
    for (const tax of [10.01, 0.01, 99.99, 1779.67]) {
        const s = computeGstSplit({ taxAmount: tax, sellerStateCode: "27", buyerStateCode: "27" });
        assert.equal(Math.round((s.cgst + s.sgst) * 100), Math.round(tax * 100));
    }
});

// Convention (see the file header): an odd paisa lands on SGST. Kept so
// already-printed bills never change.
test("odd paisa lands on SGST", () => {
    const s = computeGstSplit({ taxAmount: 10.01, sellerStateCode: "27", buyerStateCode: "27" });
    assert.deepEqual([s.cgst, s.sgst], [5, 5.01]);
});
    assert.ok(s.cgst >= s.sgst);
});

test("different state -> IGST only", () => {
    const s = computeGstSplit({ taxAmount: 54.5, sellerStateCode: "27", buyerStateCode: "29" });
    assert.deepEqual([s.kind, s.cgst, s.sgst, s.igst], ["INTER", 0, 0, 54.5]);
});

test("missing state -> safe default is same state", () => {
    assert.equal(isInterState("27", ""), false);
    assert.equal(computeGstSplit({ taxAmount: 10, sellerStateCode: "27", buyerStateCode: "" }).kind, "INTRA");
});

test("negative tax is treated as 0", () => {
    const s = computeGstSplit({ taxAmount: -5, sellerStateCode: "27", buyerStateCode: "27" });
    assert.equal(s.cgst + s.sgst, 0);
});

test("state code from GSTIN", () => {
    assert.equal(gstinDerivedStateCode("27ABCDE1234F1Z5"), "27");
    assert.equal(gstinDerivedStateCode(" 9"), "");
    assert.equal(gstinDerivedStateCode(null), "");
});
