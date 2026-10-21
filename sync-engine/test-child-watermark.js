"use strict";

/**
 * Regression test: a parent's watermark must not move until its children are in.
 *
 * On 19 Oct 2026 a till held a BankStatementImport row with none of its three
 * BankStatementLine rows. The cycle that pulled the upload was stepped aside for a
 * targeted pull between pass 1 (parents) and pass 2 (children), the parent's
 * watermark had already moved, and no later cycle asked for those children again.
 * A child pull that FAILS leaves the same hole, and that is what this test drives
 * (a kill is not reproducible in-process; both end at the same point).
 *
 * Needs two EMPTY, disposable databases, as test-reconcile.js does:
 *
 *   $env:TEST_SOURCE_URL = "postgresql://postgres@localhost:55999/src"
 *   $env:TEST_LOCAL_URL  = "postgresql://postgres@localhost:55999/rep"
 *   node test-child-watermark.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pool } = require("./lib/db");
const { main } = require("./sync-once.js");

const SOURCE_URL = process.env.TEST_SOURCE_URL;
const LOCAL_URL = process.env.TEST_LOCAL_URL;
if (!SOURCE_URL || !LOCAL_URL) {
    console.error("Set TEST_SOURCE_URL and TEST_LOCAL_URL to two EMPTY, disposable databases.");
    process.exit(2);
}

const DDL = `
    DROP TABLE IF EXISTS "WmChild", "WmParent", "WmRule", "WmGroup", _sync_state, _sync_status CASCADE;
    CREATE TABLE "WmGroup" (id int PRIMARY KEY, name text NOT NULL);
    CREATE TABLE "WmRule"  (id int PRIMARY KEY, "groupId" int NOT NULL REFERENCES "WmGroup"(id), note text NOT NULL);
    CREATE TABLE "WmParent" (id int PRIMARY KEY, "createdAt" timestamp(3) NOT NULL);
    CREATE TABLE "WmChild"  (id int PRIMARY KEY, "parentId" int NOT NULL REFERENCES "WmParent"(id), note text NOT NULL);
`;

let failures = 0;
function check(label, actual, expected) {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

(async () => {
    const registryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wm-")), "sync-tables.json");
    fs.writeFileSync(registryPath, JSON.stringify({
        ignore: ["_sync_state", "_sync_status", "_sync_dirty"],
        tables: {
            WmParent: { n: 9001, table: "WmParent", pk: ["id"], strategy: "append", column: "createdAt" },
            WmChild:  { n: 9002, table: "WmChild",  pk: ["id"], strategy: "child", parent: "WmParent", fk: "parentId" },
            // A `full` parent has no watermark: the mark is children_pending instead.
            WmGroup:  { n: 9003, table: "WmGroup",  pk: ["id"], strategy: "full" },
            WmRule:   { n: 9004, table: "WmRule",   pk: ["id"], strategy: "child", parent: "WmGroup", fk: "groupId" },
        },
    }));
    const pools = { source: pool(SOURCE_URL, 6), local: pool(LOCAL_URL, 6) };
    const cfg = { registryPath };
    const opts = { DRY: false, ONLY: null, VERIFY_NOW: [], REASON: "relay" };
    const one = (p, sql, args) => p.query(sql, args).then((r) => r.rows[0]);

    try {
        await pools.source.query(DDL);
        await pools.local.query(DDL);
        await pools.source.query(`INSERT INTO "WmParent" VALUES (1, now())`);
        await pools.source.query(`INSERT INTO "WmChild" VALUES (1, 1, 'ok'), (2, 1, 'refused here')`);
        await pools.source.query(`INSERT INTO "WmGroup" VALUES (1, 'retail')`);
        await pools.source.query(`INSERT INTO "WmRule" VALUES (1, 1, 'ok'), (2, 1, 'refused here')`);
        // The replica refuses one child row, so the child pull fails after the parent
        // landed. The schema guard compares columns only, so this is not drift.
        await pools.local.query(`ALTER TABLE "WmChild" ADD CONSTRAINT refuse CHECK (note <> 'refused here')`);
        await pools.local.query(`ALTER TABLE "WmRule" ADD CONSTRAINT refuse_rule CHECK (note <> 'refused here')`);

        console.log("\n1. Child pull fails after the parent landed");
        await main(opts, cfg, pools);
        check("parent rows on the replica", (await one(pools.local, `SELECT count(*)::int n FROM "WmParent"`)).n, 1);
        check("child rows on the replica", (await one(pools.local, `SELECT count(*)::int n FROM "WmChild"`)).n, 0);
        const wm = await one(pools.local, `SELECT watermark FROM _sync_state WHERE table_num = 9001`);
        check("parent watermark held back", wm ? wm.watermark : null, null);
        check("full parent rows on the replica", (await one(pools.local, `SELECT count(*)::int n FROM "WmGroup"`)).n, 1);
        check("full parent's children on the replica", (await one(pools.local, `SELECT count(*)::int n FROM "WmRule"`)).n, 0);
        const pend = await one(pools.local, `SELECT children_pending FROM _sync_state WHERE table_num = 9003`);
        check("full parent marked children_pending", pend ? pend.children_pending : null, true);

        console.log("\n2. Next cycle, the fault gone: the children come with the re-pulled parent");
        await pools.local.query(`ALTER TABLE "WmChild" DROP CONSTRAINT refuse`);
        await pools.local.query(`ALTER TABLE "WmRule" DROP CONSTRAINT refuse_rule`);
        await main(opts, cfg, pools);
        check("child rows on the replica", (await one(pools.local, `SELECT count(*)::int n FROM "WmChild"`)).n, 2);
        const wm2 = await one(pools.local, `SELECT watermark FROM _sync_state WHERE table_num = 9001`);
        check("parent watermark now written", wm2 != null && wm2.watermark != null, true);
        // The group's fingerprint already matches — only the mark makes it re-pull.
        check("full parent's children on the replica", (await one(pools.local, `SELECT count(*)::int n FROM "WmRule"`)).n, 2);
        const pend2 = await one(pools.local, `SELECT children_pending FROM _sync_state WHERE table_num = 9003`);
        check("children_pending cleared", pend2.children_pending, false);
    } finally {
        await Promise.allSettled([pools.source.end(), pools.local.end()]);
    }
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
