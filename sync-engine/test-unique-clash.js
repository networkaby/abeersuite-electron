"use strict";

/**
 * Unique-value moves between rows must not stop a table syncing.
 *
 *   $env:TEST_LOCAL_URL = "postgresql://postgres@localhost:55999/rep"   # an EMPTY, disposable database
 *   pnpm test:unique-clash
 *
 * Builds its own tables (_t_uc_grp, _outbox) and drops them at the end.
 */

const { Client } = require("pg");
const { inReplicaTransaction } = require("./lib/db");
const { upsert } = require("./lib/pull");

const url = process.env.TEST_LOCAL_URL;
if (!url) { console.error("Set TEST_LOCAL_URL to an EMPTY, disposable database."); process.exit(2); }

let failed = 0;
function check(label, ok, detail) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -> ${JSON.stringify(detail)}`}`);
    if (!ok) failed++;
}

(async () => {
    const c = new Client({ connectionString: url });
    await c.connect();
    const T = "_t_uc_grp";
    const names = async () => (await c.query(`SELECT id, name FROM "${T}" ORDER BY id`)).rows.map((r) => `${r.id}:${r.name}`);
    try {
        await c.query(`DROP TABLE IF EXISTS "${T}"; DROP TABLE IF EXISTS "_outbox"`);
        await c.query(`CREATE TABLE "${T}" (id int PRIMARY KEY, name text NOT NULL UNIQUE, "updatedAt" timestamptz)`);
        await c.query(`INSERT INTO "${T}" VALUES (1,'A','2026-01-01'),(2,'B','2026-01-01'),(3,'C','2026-01-01')`);
        const t2 = new Date("2026-02-01");

        // 1. swap A <-> B in one page
        await inReplicaTransaction(c, () => upsert(c, T, ["id"], [
            { id: 1, name: "B", updatedAt: t2 }, { id: 2, name: "A", updatedAt: t2 },
        ]));
        check("swap in one page", JSON.stringify(await names()) === JSON.stringify(["1:B", "2:A", "3:C"]), await names());

        // 2. row 3 deleted upstream, row 1 takes its name ("Converter & Adapter" case)
        await inReplicaTransaction(c, () => upsert(c, T, ["id"], [{ id: 1, name: "C", updatedAt: new Date("2026-03-01") }]));
        check("name taken from a deleted row", JSON.stringify(await names()) === JSON.stringify(["1:C", "2:A"]), await names());

        // 3. a counter's own unpushed row is never cleared: the clash still fails loudly
        await c.query(`INSERT INTO "${T}" VALUES (50,'Mine','2026-03-01')`);
        await c.query(`CREATE TABLE "_outbox" (id serial, table_name text, row_key jsonb, pushed_at timestamptz, dead_lettered_at timestamptz)`);
        await c.query(`INSERT INTO "_outbox"(table_name,row_key) VALUES ($1, '{"id":50}')`, [T]);
        let threw = false;
        try {
            await inReplicaTransaction(c, () => upsert(c, T, ["id"], [{ id: 2, name: "Mine", updatedAt: new Date("2026-04-01") }]));
        } catch (e) { threw = /unique/i.test(e.message); }
        check("unpushed local row is protected", threw && (await names()).includes("50:Mine"), await names());

        // 4. a row whose own value did not move is untouched
        await inReplicaTransaction(c, () => upsert(c, T, ["id"], [{ id: 2, name: "A", updatedAt: new Date("2026-05-01") }]));
        check("unchanged value: no deletes", JSON.stringify(await names()) === JSON.stringify(["1:C", "2:A", "50:Mine"]), await names());
    } finally {
        await c.query(`DROP TABLE IF EXISTS "${T}"; DROP TABLE IF EXISTS "_outbox"`).catch(() => {});
        await c.end();
    }
    console.log(failed ? `${failed} FAILED` : "all passed");
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
