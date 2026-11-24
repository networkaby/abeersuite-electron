// Unit tests: warranty end dates. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { warrantyEndDate, warrantiesEndingSoon, indiaDay, type SoldItem } from "./warrantyEnd";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const item = (o: Partial<SoldItem>): SoldItem => ({ productName: "Laptop", billNo: "POS-1", billDate: d("2025-12-12"), durationDays: 365, ...o });
const NOW = new Date("2026-11-24T06:00:00Z"); // 24 Nov 2026, 11:30 IST

test("end date = bill date + warranty days", () => {
    assert.equal(warrantyEndDate(d("2025-12-12"), 365)?.toISOString().slice(0, 10), "2026-12-12");
    assert.equal(warrantyEndDate(d("2025-12-12"), 0), null);
    assert.equal(warrantyEndDate(d("2025-12-12"), null), null);
});

test("India day: 23 Nov 20:00 UTC is already 24 Nov in India", () => {
    assert.equal(indiaDay(new Date("2026-11-23T20:00:00Z")).toISOString().slice(0, 10), "2026-11-24");
});

test("bill-wise: same product on two bills = two rows, soonest first", () => {
    const rows = warrantiesEndingSoon([
        item({ billNo: "SAL-9", billDate: d("2026-01-20") }),   // ends 20 Jan 2027 -> 57 days
        item({ billNo: "POS-1", billDate: d("2025-12-12") }),   // ends 12 Dec 2026 -> 18 days
    ], NOW);
    assert.deepEqual(rows.map((r) => [r.productName, r.endsOn, r.daysLeft]), [
        ["Laptop · POS-1", "2026-12-12", 18],
        ["Laptop · SAL-9", "2027-01-20", 57],
    ]);
    assert.equal(rows[0].endsAt, "12 Dec 2026");
});

test("ended, too far away, or no warranty -> left out", () => {
    const rows = warrantiesEndingSoon([
        item({ billDate: d("2025-11-01") }),   // ended 1 Nov 2026
        item({ billDate: d("2026-06-01") }),   // ends Jun 2027, > 90 days
        item({ durationDays: 0 }),
    ], NOW);
    assert.equal(rows.length, 0);
});

test("ends today counts; at most 5 rows", () => {
    assert.equal(warrantiesEndingSoon([item({ billDate: d("2025-11-24") })], NOW)[0].daysLeft, 0);
    const many = Array.from({ length: 8 }, (_, i) => item({ billNo: `POS-${i}`, billDate: d("2025-12-12") }));
    assert.equal(warrantiesEndingSoon(many, NOW).length, 5);
});

test("no bill number -> just the name", () => {
    assert.equal(warrantiesEndingSoon([item({ billNo: null })], NOW)[0].productName, "Laptop");
});
