import { test } from "node:test";
import assert from "node:assert/strict";
import { takeRowWhere, takeableWhere } from "./queueTake";

const cut = new Date("2026-11-26T10:00:00Z");

test("queued rows are taken, and stuck pending rows of a known kind", () => {
    assert.deepEqual(takeableWhere("pushStatus", cut, ["SALE"]), {
        OR: [
            { pushStatus: "queued" },
            { pushStatus: "pending", updatedAt: { lt: cut }, kind: { in: ["SALE"] } },
        ],
    });
});

test("a queued row is taken only while still queued", () => {
    assert.deepEqual(takeRowWhere("status", 5, "queued", cut), { id: 5, status: "queued" });
});

test("a stuck row is taken only while still pending and still old", () => {
    assert.deepEqual(takeRowWhere("status", 5, "pending", cut), { id: 5, status: "pending", updatedAt: { lt: cut } });
});
