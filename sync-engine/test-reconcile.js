"use strict";

/**
 * Regression test for the divergences a KEY hash cannot see.
 *
 * These are worth a test rather than an eyeball because every one of them is silent:
 * the replica does not error, the cycle reports success, `last_verify_at` stays
 * populated with an empty `last_error`, and the counter quietly serves a different
 * answer from the office. Each check below reproduces a fault that actually reached a
 * live counter, and every one of them was reported as "verified" at the time.
 *
 * It needs TWO EMPTY DATABASES — one standing in for Supabase, one for the replica —
 * and it creates and drops its own tables in them. Point it anywhere disposable:
 *
 *   $env:TEST_SOURCE_URL = "postgresql://postgres@localhost:55999/src"
 *   $env:TEST_LOCAL_URL  = "postgresql://postgres@localhost:55999/rep"
 *   node test-reconcile.js
 *
 * A throwaway cluster is enough, and the app already ships the binaries to make one:
 *
 *   initdb -D $env:TEMP\rctest -U postgres -E UTF8 --locale=C -A trust
 *   pg_ctl -D $env:TEMP\rctest -o "-p 55999" -l $env:TEMP\rctest.log start
 *   psql -h localhost -p 55999 -U postgres -c "create database src" -c "create database rep"
 *
 * The local role must be allowed to SET session_replication_role (see README) — the
 * test writes to the replica the same way the worker does.
 */

const { pool } = require("./lib/db");
const reconcile = require("./lib/reconcile");
const { pullByKeys } = require("./lib/pull");
const { repairReferencing } = require("./sync-once.js");

const SOURCE_URL = process.env.TEST_SOURCE_URL;
const LOCAL_URL = process.env.TEST_LOCAL_URL;

if (!SOURCE_URL || !LOCAL_URL) {
    console.error("Set TEST_SOURCE_URL and TEST_LOCAL_URL to two EMPTY, disposable databases.");
    process.exit(2);
}

/** Stand-ins for real registry entries, with the strategies that matter here. */
const tables = {
    Company: { n: 1, table: "Company", pk: ["id"], strategy: "watermark", column: "updatedAt" },
    Person: { n: 2, table: "Person", pk: ["id"], strategy: "watermark", column: "updatedAt" },
    UserSurfaceSeen: {
        n: 3, table: "UserSurfaceSeen", pk: ["userId", "surface"],
        strategy: "child", parent: "User", fk: "userId",
    },
};

const SCHEMA = `
DROP TABLE IF EXISTS "UserSurfaceSeen";
DROP TABLE IF EXISTS "Person";
DROP TABLE IF EXISTS "Company";
CREATE TABLE "Company" (id int PRIMARY KEY, name text);
CREATE TABLE "Person" (
  id int PRIMARY KEY,
  name text,
  "convertedToCompanyId" int REFERENCES "Company"(id) ON UPDATE CASCADE ON DELETE SET NULL,
  "updatedAt" timestamp NOT NULL
);
CREATE TABLE "UserSurfaceSeen" (
  "userId" int, surface text, "seenAt" timestamp,
  PRIMARY KEY ("userId", surface)
);
INSERT INTO "Company" VALUES (17, 'Acme'), (18, 'Beta');
INSERT INTO "Person" VALUES
  (8282, 'JSK',   17, '2026-08-19 04:54:18.013'),
  (9000, 'Other', 18, '2026-08-19 04:54:18.013');
INSERT INTO "UserSurfaceSeen" VALUES
  (7, 'help',  '2026-09-05 21:32:02.777'),
  (7, 'deals', '2026-09-01 10:00:00');
`;

let failures = 0;
function check(name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures++;
    console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}`);
    if (!ok) {
        console.log(`          got  ${JSON.stringify(got)}`);
        console.log(`          want ${JSON.stringify(want)}`);
    }
}

async function main() {
    const sp = pool(SOURCE_URL, 2);
    const lp = pool(LOCAL_URL, 2);
    const source = await sp.connect();
    const local = await lp.connect();

    try {
        await source.query(SCHEMA);
        await local.query(SCHEMA);

        // The office hard-deletes a company. Its FK fires there and nulls the pointer,
        // WITHOUT moving updatedAt — the change was made by PostgreSQL, not by Prisma.
        await source.query('DELETE FROM "Company" WHERE id = 17');
        // The replica applies the same delete the way the worker does: with FK actions
        // suspended, so the pointer is left behind. This is the whole bug.
        await local.query('SET session_replication_role = replica');
        await local.query('DELETE FROM "Company" WHERE id = 17');
        await local.query('SET session_replication_role = DEFAULT');
        // And a child row edited on the source without its parent moving.
        await source.query(
            `UPDATE "UserSurfaceSeen" SET "seenAt" = '2026-09-07 19:24:52.202'
              WHERE "userId" = 7 AND surface = 'help'`,
        );

        console.log("\n1. A foreign key rewrote a row on the source (Person.convertedToCompanyId)");

        check("FK introspection finds the referencing column",
            await reconcile.referencingNullers(local, "Company"),
            [{ table: "Person", column: "convertedToCompanyId" }]);

        const kSrc = await reconcile.fingerprint(source, tables.Person);
        const kLoc = await reconcile.fingerprint(local, tables.Person, kSrc.columns || []);
        check("a key hash reports the table clean — this is why the bug survived",
            reconcile.same(kSrc, kLoc), true);

        const changed = new Set();
        check("repairReferencing re-pulls the affected row",
            await repairReferencing(source, local, tables,
                { nullers: new Map(), byTable: null }, tables.Company, ["17"], changed), 1);
        check("...and tells the screens the model moved", [...changed], ["Person"]);
        // The one that matters: upsert's monotonic guard would skip this write, because
        // the two sides' updatedAt are IDENTICAL. Reconciliation must overrule it.
        check("the replica row actually changed on disk",
            (await local.query('SELECT "convertedToCompanyId" AS c FROM "Person" WHERE id = 8282')).rows[0].c,
            null);

        console.log("\n2. A child row edited in place, without its parent moving");

        check("child tables hash row contents", reconcile.hashesRowContent(tables.UserSurfaceSeen), true);
        check("watermark tables do not", reconcile.hashesRowContent(tables.Person), false);

        const cSrc = await reconcile.fingerprint(source, tables.UserSurfaceSeen);
        const cLoc = await reconcile.fingerprint(local, tables.UserSurfaceSeen, cSrc.columns || []);
        check("the content hash catches the drift", reconcile.same(cSrc, cLoc), false);

        const kd = await reconcile.keyDiff(source, local, tables.UserSurfaceSeen);
        check("keyDiff has nothing to say about it — hence rowHashDiff",
            [kd.onlyLocal.length, kd.onlySource.length], [0, 0]);

        const expected = (await source.query(
            `SELECT ${reconcile.keyExpression(tables.UserSurfaceSeen)} AS k
               FROM "UserSurfaceSeen" WHERE "userId" = 7 AND surface = 'help'`,
        )).rows[0].k;
        const drift = await reconcile.rowHashDiff(source, local, tables.UserSurfaceSeen, cSrc.columns || []);
        check("rowHashDiff names exactly the drifted row", drift, [expected]);

        await pullByKeys(source, local, tables.UserSurfaceSeen, drift);
        const cAfter = await reconcile.fingerprint(local, tables.UserSurfaceSeen, cSrc.columns || []);
        check("equal after the repair", reconcile.same(cSrc, cAfter), true);

        console.log("\n3. A replica whose schema is behind the source");

        // The office adds a column; this replica has not been updated yet. Every row now
        // reads as different — for one schema reason, not N data reasons — and a repair
        // must NOT be attempted, since upsert names the source's columns and would fail
        // on every batch.
        await source.query('ALTER TABLE "UserSurfaceSeen" ADD COLUMN "sourceCounterId" int');

        const bSrc = await reconcile.fingerprint(source, tables.UserSurfaceSeen);
        const bLoc = await reconcile.fingerprint(local, tables.UserSurfaceSeen, bSrc.columns || []);
        check("every row now reads as different", reconcile.same(bSrc, bLoc), false);
        check("...and it is named as a missing column, not as drifted rows",
            reconcile.missingColumns(bSrc, bLoc), ["sourceCounterId"]);

        // The other direction stays tolerated: a column the replica kept and the source
        // dropped must never read as a difference.
        await local.query('ALTER TABLE "UserSurfaceSeen" ADD COLUMN "legacyNote" text');
        const tSrc = await reconcile.fingerprint(source, tables.UserSurfaceSeen);
        const tLoc = await reconcile.fingerprint(local, tables.UserSurfaceSeen, tSrc.columns || []);
        check("a replica-only column is still tolerated",
            reconcile.missingColumns(tSrc, tLoc), ["sourceCounterId"]);
    } finally {
        local.release();
        source.release();
        await sp.end();
        await lp.end();
    }

    console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} CHECK(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
