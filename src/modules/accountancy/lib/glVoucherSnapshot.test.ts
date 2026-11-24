// Unit tests: voucher form "did anything change?" check. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { denomKey, normalizeLines, snapshotsEqual, type Snapshot } from "./glVoucherSnapshot";

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
    date: "2026-11-24", narration: "",
    lines: normalizeLines([{ accountId: 2, type: "CREDIT", amount: 100 }, { accountId: 1, type: "DEBIT", amount: 100 }]),
    denom: "", ...o,
});

test("same lines in another order -> no change", () => {
    const other = snap({ lines: normalizeLines([{ accountId: 1, type: "DEBIT", amount: 100 }, { accountId: 2, type: "CREDIT", amount: 100 }]) });
    assert.ok(snapshotsEqual(snap(), other));
});

test("amount, date, narration or note text change -> changed", () => {
    assert.ok(!snapshotsEqual(snap(), snap({ lines: normalizeLines([{ accountId: 1, type: "DEBIT", amount: 101 }, { accountId: 2, type: "CREDIT", amount: 101 }]) })));
    assert.ok(!snapshotsEqual(snap(), snap({ date: "2026-11-25" })));
    assert.ok(!snapshotsEqual(snap(), snap({ narration: "rent" })));
    assert.ok(!snapshotsEqual(snap(), snap({ lines: normalizeLines([{ accountId: 1, type: "DEBIT", amount: 100, description: "x" }, { accountId: 2, type: "CREDIT", amount: 100 }]) })));
});

test("float noise and spaces are not a change", () => {
    const noisy = snap({ lines: normalizeLines([{ accountId: 1, type: "DEBIT", amount: 0.1 + 99.9 }, { accountId: 2, type: "CREDIT", amount: 100, description: "  " }]) });
    assert.ok(snapshotsEqual(snap(), noisy));
});

test("payment method / reference is part of the line", () => {
    const withUpi = snap({ lines: normalizeLines([{ accountId: 1, type: "DEBIT", amount: 100, method: "UPI", reference: " 123 " }, { accountId: 2, type: "CREDIT", amount: 100 }]) });
    assert.ok(!snapshotsEqual(snap(), withUpi));
    assert.equal(withUpi.lines[0].instrument, "UPI|123");
});

test("denomKey: zero counts and order do not matter; null is empty", () => {
    const a = denomKey({ notes: { 500: 2, 100: 0, 10: 3 }, cheques: [] } as never);
    const b = denomKey({ notes: { 10: 3, 500: 2 }, cheques: [] } as never);
    assert.equal(a, b);
    assert.equal(denomKey(null), "");
});
