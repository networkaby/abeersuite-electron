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
const { pullByKeys, refreshByKeys, recheckBehindCursor, deleteByKeys } = require("./lib/pull");
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
    // Compound-keyed, like the real one — that is what makes check 4 bite: a guard
    // joined on `_outbox.row_pk` passes on single-column keys and silently fails here.
    VoucherSeriesCounter: {
        n: 4, table: "VoucherSeriesCounter", pk: ["kind", "counterNumber"],
        strategy: "watermark", column: "updatedAt", localAuthority: true,
    },
    // The same table WITHOUT the ownership flag: the outbox hold on its own.
    PlainCounter: {
        n: 5, table: "VoucherSeriesCounter", pk: ["kind", "counterNumber"],
        strategy: "watermark", column: "updatedAt",
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
DROP TABLE IF EXISTS "VoucherSeriesCounter";
CREATE TABLE "VoucherSeriesCounter" (
  kind text, "counterNumber" int, "nextSeq" int NOT NULL DEFAULT 0,
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, "counterNumber")
);
`;

/** The replica's outbox, cut down to the columns the guard reads (local-schema.sql). */
const OUTBOX = `
DROP TABLE IF EXISTS "_outbox";
CREATE TABLE "_outbox" (
  id serial PRIMARY KEY, table_name text NOT NULL, row_pk text NOT NULL,
  row_key jsonb NOT NULL DEFAULT '{}'::jsonb, operation text NOT NULL,
  payload jsonb NOT NULL, pushed_at timestamptz, dead_lettered_at timestamptz
);
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

        console.log("\n4. A row this counter wrote and has not pushed yet is not an upstream delete");

        // Three counter rows exist here and none on the source. Counter 2's row is still
        // waiting in the outbox (the case that re-issued invoice numbers), counter 3's
        // was pushed and then genuinely deleted upstream, counter 4's was refused.
        // `row_pk` is written the way the real trigger writes it — chr(31) — so a guard
        // joined on it would match nothing; the assertions below would then fail.
        await local.query(OUTBOX);
        await local.query(`
            INSERT INTO "VoucherSeriesCounter" (kind, "counterNumber", "nextSeq")
            VALUES ('SALE', 2, 418), ('SALE', 3, 7), ('SALE', 4, 1);
            INSERT INTO "_outbox" (table_name, row_pk, row_key, operation, payload, pushed_at, dead_lettered_at) VALUES
              ('VoucherSeriesCounter', 'SALE' || chr(31) || '2', '{"kind":"SALE","counterNumber":2}', 'create', '{}', NULL,   NULL),
              ('VoucherSeriesCounter', 'SALE' || chr(31) || '3', '{"kind":"SALE","counterNumber":3}', 'create', '{}', now(), NULL),
              ('VoucherSeriesCounter', 'SALE' || chr(31) || '4', '{"kind":"SALE","counterNumber":4}', 'create', '{}', NULL,   now());
        `);
        const sep = reconcile.KEY_SEPARATOR;
        const k2 = `SALE${sep}2`, k3 = `SALE${sep}3`, k4 = `SALE${sep}4`;

        check("keyExpression renders the key with KEY_SEPARATOR — the constant is the truth",
            (await local.query(`SELECT ${reconcile.keyExpression(tables.PlainCounter)} AS k
                                  FROM "VoucherSeriesCounter" WHERE "counterNumber" = 2`)).rows[0].k, k2);

        const diff = await reconcile.keyDiff(source, local, tables.PlainCounter);
        check("keyDiff reports all three as onlyLocal", diff.onlyLocal.sort(), [k2, k3, k4]);

        const plain = await deleteByKeys(local, tables.PlainCounter, diff.onlyLocal);
        check("the pending row is held back", plain.heldKeys, [k2]);
        check("the pushed and dead-lettered rows are deleted — a real repair still repairs",
            [plain.removed, plain.deletedKeys.sort()], [2, [k3, k4]]);
        check("...and counter 2's number survived on disk",
            (await local.query(`SELECT "nextSeq" AS n FROM "VoucherSeriesCounter" WHERE "counterNumber" = 2`)).rows[0].n, 418);

        // With the ownership flag nothing goes, whatever the outbox says: this is the
        // second lock, for the table where a lost row means duplicate bills.
        await local.query(`INSERT INTO "VoucherSeriesCounter" (kind, "counterNumber", "nextSeq") VALUES ('SALE', 3, 7), ('SALE', 4, 1)`);
        const owned = await deleteByKeys(local, tables.VoucherSeriesCounter, [k2, k3, k4]);
        check("a localAuthority table deletes nothing, pushed or not",
            [owned.removed, owned.heldKeys.sort(), owned.deletedKeys], [0, [k2, k3, k4], []]);
        check("...all three rows still there",
            (await local.query(`SELECT count(*)::int AS c FROM "VoucherSeriesCounter"`)).rows[0].c, 3);

        // A machine with no outbox (the office) is simply unguarded, not broken.
        await local.query('DROP TABLE "_outbox"');
        const bare = await deleteByKeys(local, tables.PlainCounter, [k2]);
        check("no _outbox table → nothing held", [bare.removed, bare.heldKeys], [1, []]);

        console.log("\n5. An edit stamped behind the cursor (a late commit, an offline push, a skewed clock)");

        check("watermark tables hash the stamp beside the key", reconcile.stampColumn(tables.Person), "updatedAt");
        check("...but not a localAuthority one, whose stamps differ by design",
            reconcile.stampColumn(tables.VoucherSeriesCounter), null);
        check("...nor append, whose createdAt an edit never moves",
            reconcile.stampColumn({ ...tables.Person, strategy: "append", column: "createdAt" }), null);

        // The office edits 9000; the replica never pulled it because its stamp sits
        // behind the cursor. Meanwhile this counter edited 8282 and has not pushed it.
        await source.query(`UPDATE "Person" SET name = 'Other, edited', "updatedAt" = '2026-08-19 05:00:00' WHERE id = 9000`);
        await local.query(`UPDATE "Person" SET name = 'JSK, local', "updatedAt" = '2026-08-19 06:00:00' WHERE id = 8282`);
        await local.query(OUTBOX);
        await local.query(`INSERT INTO "_outbox" (table_name, row_pk, row_key, operation, payload)
                           VALUES ('Person', '8282', '{"id":8282}', 'update', '{}')`);

        const sSrc = await reconcile.fingerprint(source, tables.Person);
        const sLoc = await reconcile.fingerprint(local, tables.Person);
        check("the stamped hash sees what a key hash called clean", reconcile.same(sSrc, sLoc), false);

        const sd = await reconcile.keyDiff(source, local, tables.Person);
        check("keyDiff names both rows as stale, and nothing missing",
            [sd.stale.sort(), sd.onlyLocal, sd.onlySource], [["8282", "9000"], [], []]);

        const rf = await refreshByKeys(source, local, tables.Person, sd.stale);
        check("the missed edit is refreshed, the unpushed local edit held",
            [rf.refreshed, rf.heldKeys], [1, ["8282"]]);
        check("...the office's edit is on disk",
            (await local.query(`SELECT name FROM "Person" WHERE id = 9000`)).rows[0].name, "Other, edited");
        check("...and the counter's own edit survived",
            (await local.query(`SELECT name FROM "Person" WHERE id = 8282`)).rows[0].name, "JSK, local");

        console.log("\n6. A row that committed after the last pull passed its stamp");

        // Stamped as the office would now, in UTC. The cursor row (9200) is on both
        // sides; 9100 committed late as a NEW row and 9000 as an EDIT, both stamped
        // behind it; 8282 is newer here (the unpushed edit) and must not be pulled; 9300
        // ties the cursor stamp with a higher id, so it is ahead and the drain's job.
        await local.query(`DELETE FROM "_outbox"`);
        const utc = (sec) => `(now() AT TIME ZONE 'UTC') - interval '${sec} seconds'`;
        await source.query(`
            UPDATE "Person" SET "updatedAt" = ${utc(40)} WHERE id = 8282;
            UPDATE "Person" SET name = 'Other, late', "updatedAt" = ${utc(20)} WHERE id = 9000;
            INSERT INTO "Person" (id, name, "updatedAt") VALUES (9100, 'Late new', ${utc(30)});
            INSERT INTO "Person" (id, name, "updatedAt") VALUES (9200, 'Cursor row', ${utc(10)});
            INSERT INTO "Person" (id, name, "updatedAt") SELECT 9300, 'Ahead', "updatedAt" FROM "Person" WHERE id = 9200;
        `);
        await local.query(`UPDATE "Person" SET "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = 8282`);
        // Read the cursor the way the worker does: a Date off a zone-less column. Writing
        // it back is the worker's own round trip, so 9200 lands with the identical stamp.
        const cursor = (await source.query(`SELECT "updatedAt" AS t FROM "Person" WHERE id = 9200`)).rows[0].t;
        await local.query(`INSERT INTO "Person" (id, name, "updatedAt") VALUES (9200, 'Cursor row', $1)`, [cursor]);

        const late = await recheckBehindCursor(source, local, tables.Person, cursor, "9200");
        check("the late edit and the late row are pulled, nothing else",
            [late.pulled, late.ids.sort()], [2, ["9000", "9100"]]);
        check("...the late edit is on disk",
            (await local.query(`SELECT name FROM "Person" WHERE id = 9000`)).rows[0].name, "Other, late");
        check("...the newer local edit is untouched",
            (await local.query(`SELECT name FROM "Person" WHERE id = 8282`)).rows[0].name, "JSK, local");
        check("...and the row ahead of the cursor is left to the drain",
            (await local.query(`SELECT count(*)::int AS c FROM "Person" WHERE id = 9300`)).rows[0].c, 0);

        const stale = new Date(cursor.getTime() - 20 * 60 * 1000);
        check("a cursor older than the horizon costs no query at all",
            await recheckBehindCursor({ query: () => { throw new Error("queried"); } }, local, tables.Person, stale, "9200"),
            { pulled: 0, ids: [] });
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
