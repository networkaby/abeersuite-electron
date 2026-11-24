// Unit tests: change-signal topics. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { TOPIC_MODELS, topicsForApiPath } from "./topics";

type SyncEntry = { strategy?: string };
const registry = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "prisma", "sync-tables.json"), "utf8"),
) as { tables: Record<string, SyncEntry> };
const tables = registry.tables;
const listed = new Set(Object.values(TOPIC_MODELS).flat());

// A till's own save is pulled by its topics' models; a table in no topic would only
// arrive on the sweep a minute later.
test("every synced root table is named by some topic", () => {
    const missing = Object.entries(tables)
        .filter(([, t]) => t.strategy !== "child")
        .map(([m]) => m)
        .filter((m) => !listed.has(m));
    assert.deepEqual(missing, [], `add these to TOPIC_MODELS in topics.ts: ${missing.join(", ")}`);
});

test("TOPIC_MODELS names only real sync tables", () => {
    const unknown = [...listed].filter((m) => !tables[m]);
    assert.deepEqual(unknown, []);
});

test("preview POSTs never announce", () => {
    assert.deepEqual(topicsForApiPath("/api/settings/item-import/preview"), []);
    assert.deepEqual(topicsForApiPath("/api/shop/tier-preview"), []);
});

test("imports wake the screens of what they write", () => {
    assert.ok(topicsForApiPath("/api/settings/item-import/commit").includes("catalogue"));
    assert.ok(topicsForApiPath("/api/settings/customer-import/commit").includes("parties"));
});
