// Unit tests: which bills a payment settles, and ageing. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { autoLinkOrder, assignSources, dueDateOf, planLinks, sideOf, type LinkableDoc } from "./billLinkPlan";
import { bucketFor } from "./ageing";

const doc = (id: number, dueDate: string, open: number): LinkableDoc => ({
    universalVoucherId: id, voucherType: "SALE", ref: `S-${id}`, date: dueDate, dueDate, side: 1, face: open, linked: 0, open,
});

test("due date = bill date + credit days (default 30), in UTC", () => {
    assert.equal(dueDateOf("2026-11-01T00:00:00Z", 15).toISOString().slice(0, 10), "2026-11-16");
    assert.equal(dueDateOf("2026-11-01T00:00:00Z").toISOString().slice(0, 10), "2026-12-01");
});

test("auto order: oldest due first; same due -> smaller bill first", () => {
    const order = autoLinkOrder([doc(1, "2026-11-10", 500), doc(2, "2026-10-01", 900), doc(3, "2026-11-10", 200)]);
    assert.deepEqual(order.map((d) => d.universalVoucherId), [2, 3, 1]);
});

test("planLinks: money fills bills in auto order, last one partly", () => {
    const docs = [doc(1, "2026-11-10", 500), doc(2, "2026-10-01", 900), doc(3, "2026-11-10", 200)];
    assert.deepEqual(planLinks(docs, 1200).picks, { 2: 900, 3: 200, 1: 100 });
});

test("planLinks: hand ticks kept first, and cut to what the bill still owes", () => {
    const docs = [doc(1, "2026-11-10", 500), doc(2, "2026-10-01", 900)];
    const r = planLinks(docs, 1000, { existing: { 1: 700 } });
    assert.deepEqual(r.picks, { 1: 500, 2: 500 });
    assert.deepEqual(r.clamped, [1]);
});

test("assignSources: the voucher's own money first, then old credits", () => {
    const plan = assignSources([{ id: 1, amount: 6000 }, { id: 2, amount: 5000 }], 10_000, [{ id: 77, amount: 1000 }]);
    assert.deepEqual(plan, [
        { sourceId: null, links: [{ universalVoucherId: 1, amount: 6000 }, { universalVoucherId: 2, amount: 4000 }] },
        { sourceId: 77, links: [{ universalVoucherId: 2, amount: 1000 }] },
    ]);
});

test("side of a signed balance; paisa noise is no side", () => {
    assert.equal(sideOf(10), 1);
    assert.equal(sideOf(-10), -1);
    assert.equal(sideOf(0.004), 0);
});

test("ageing buckets: 0-30, 30-60, 60-90, 90+", () => {
    assert.deepEqual([0, 30, 31, 60, 61, 90, 91].map(bucketFor), ["b0_30", "b0_30", "b30_60", "b30_60", "b60_90", "b60_90", "b90_plus"]);
});
