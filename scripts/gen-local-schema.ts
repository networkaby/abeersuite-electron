#!/usr/bin/env node
/**
 * Generates `resources/local-schema.sql` — the DDL that creates the counter's local
 * replica from nothing.
 *
 *     pnpm db:local-schema          regenerate
 *     pnpm db:local-schema --check  fail if it has drifted from prisma/schema/
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * A fresh embedded PostgreSQL cluster has no tables. Something has to create 113 of
 * them, plus 52 enums, before a single row can be synced. The three ways to do that:
 *
 *   1. Replay committed migrations — the repo has `prisma/migrations/` again since
 *      2026-09-13, but replaying a whole history on a fresh shop PC is slower and
 *      more fragile than one snapshot, and the migrations start from a BASELINE of
 *      an already-live schema rather than from nothing.
 *   2. `pg_dump` the schema from Supabase at first run — needs `DIRECT_URL` (port 5432;
 *      pgbouncer cannot serve a dump) on every shop PC, and `scripts/counterEnv.ts`
 *      deliberately withholds that credential from counters.
 *   3. Bake the DDL at build time — this. No new credential, no network at first run,
 *      and the schema is versioned with the app that expects it, so an upgraded app
 *      never meets a replica built by a different schema.
 *
 * ── Why it is committed rather than generated during `pnpm build` ────────────
 * A schema change then shows up in review as a readable DDL diff, next to the
 * `prisma/schema/` change that caused it. `--check` runs in `pnpm precommit` so the two
 * cannot drift apart silently.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { NEVER_PUSH_MODELS } from "../src/shared/lib/sync/neverPush";

const ROOT = path.join(__dirname, "..");
const SCHEMA_DIR = path.join(ROOT, "prisma", "schema");
const OUT_FILE = path.join(ROOT, "resources", "local-schema.sql");
const REGISTRY_FILE = path.join(ROOT, "prisma", "sync-tables.json");

const HEADER = `-- GENERATED FILE — DO NOT EDIT BY HAND.
--
-- Regenerate with: pnpm db:local-schema
-- Verified by:     pnpm db:local-schema --check  (runs in pnpm precommit)
--
-- Creates the counter's local PostgreSQL replica from empty. Applied once, at first
-- run, by the desktop app. Source of truth is prisma/schema/ — edit that, then
-- regenerate this.
`;

/**
 * The raw Prisma diff is written for a database that has never seen it — none of
 * `CREATE TABLE`, `CREATE TYPE`, `CREATE INDEX`, `ALTER TABLE ... ADD CONSTRAINT` is
 * idempotent. That is fine for a true first run, but `localDbProvisioner.ts` also
 * re-runs this exact script on every app upgrade that changes the schema (its
 * `schema_hash` check) and after any provisioning attempt that got interrupted
 * partway — both re-apply against a database that already has some or all of these
 * objects. Without guards, the first statement that collides throws and Postgres
 * rolls back the whole multi-statement batch (it runs as one implicit transaction),
 * which is exactly what happened on a real counter: an upgrade hit
 * `type "X" already exists` and the counter silently stayed live-only forever after.
 *
 * `CREATE TABLE`/`CREATE INDEX` accept `IF NOT EXISTS` directly. `CREATE TYPE` and
 * `ADD CONSTRAINT` do not, so those are wrapped in a `DO` block that swallows
 * `duplicate_object` (42710) — the SQLSTATE both raise when the enum/constraint is
 * already there.
 *
 * ── What this still does NOT fix ─────────────────────────────────────────────
 * This file is a full from-empty snapshot, not a real diff against the previous
 * version. `addColumnBackfills()` below closes the common case — a new column on an
 * existing table — but a dropped/renamed/retyped column, or a new `NOT NULL` column
 * with no default on a table that already has rows, is not expressible as an
 * additive `ALTER` at all. Those still fail loudly rather than silently, which is
 * correct: guessing at a destructive or data-losing migration would be worse than
 * refusing. That needs a real diff-against-target migrator, which is separate work.
 */
function makeIdempotent(sql: string): string {
    let out = sql;
    out = out.replace(/^CREATE TABLE "/gm, 'CREATE TABLE IF NOT EXISTS "');
    out = out.replace(/^CREATE UNIQUE INDEX "/gm, 'CREATE UNIQUE INDEX IF NOT EXISTS "');
    out = out.replace(/^CREATE INDEX "/gm, 'CREATE INDEX IF NOT EXISTS "');

    const guard = (stmt: string) =>
        `DO $$ BEGIN\n    ${stmt}\nEXCEPTION\n    WHEN duplicate_object THEN NULL;\nEND $$;`;
    out = out.replace(/^(CREATE TYPE .+;)$/gm, (_m, stmt: string) => guard(stmt));
    out = out.replace(/^(ALTER TABLE .+ ADD CONSTRAINT .+;)$/gm, (_m, stmt: string) => guard(stmt));

    return addColumnBackfills(addEnumValueBackfills(out));
}

/**
 * Re-declares every value of every enum as `ALTER TYPE ... ADD VALUE IF NOT EXISTS`
 * right after its guarded `CREATE TYPE`, so a value added upstream reaches a replica
 * that already has the type — the enum twin of addColumnBackfills(). Reproduced for
 * real: v1.17.2 added `ShopStatus.ATTENTION`; on every counter provisioned before it
 * the guarded `CREATE TYPE` was skipped, and the first product parked in Attention
 * failed the whole InvProduct pull ("invalid input value for enum") → Copy incomplete.
 *
 * Each value goes `AFTER` the one before it, so the order matches the office's (an
 * enum sorts by declaration order). The first value has no predecessor and is only
 * appended if missing — in practice it always exists. PostgreSQL 12+ allows ADD
 * VALUE inside the implicit transaction the provisioner runs this file in; the
 * replica is PostgreSQL 17. A brand-new value cannot be USED in that same
 * transaction (e.g. as a column DEFAULT added in the same release) — that would fail
 * loudly on apply, and the next boot retries.
 */
function addEnumValueBackfills(sql: string): string {
    return sql.replace(
        /CREATE TYPE "([A-Za-z0-9_]+)" AS ENUM \(([^)]*)\);\nEXCEPTION\n {4}WHEN duplicate_object THEN NULL;\nEND \$\$;/g,
        (block: string, type: string, list: string) => {
            const values = [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
            const alters = values.map((v, i) =>
                `ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS '${v}'${i > 0 ? ` AFTER '${values[i - 1]}'` : ""};`,
            );
            return alters.length ? `${block}\n${alters.join("\n")}` : block;
        },
    );
}

/**
 * Re-declares every column of every table as a follow-up `ALTER TABLE ... ADD
 * COLUMN IF NOT EXISTS` right after its `CREATE TABLE`, so a column added to a
 * table that already existed on this replica actually reaches it — reproduced for
 * real: `pos_counters` gained `counterNumber`, and a replica provisioned before
 * that change kept failing with `column "counterNumber" does not exist` because
 * `CREATE TABLE IF NOT EXISTS` skips the whole statement once the table exists.
 *
 * A no-op for a table just created fresh in this same script run (the column
 * already exists). Postgres accepts `IF NOT EXISTS` on `ADD COLUMN` since 9.6, and
 * a populated table only rejects the add when the new column is `NOT NULL` with no
 * default — the same case `makeIdempotent()`'s doc comment above calls out as
 * staying a loud failure on purpose.
 *
 * Relies on the Prisma diff's format being exactly this regular: every table body
 * line is either a quoted `"col" type...,` definition, a `CONSTRAINT` line, or
 * blank — verified against the current 113-table file (no inline `CHECK`, no
 * column definition split across lines). A `CONSTRAINT` line never starts with a
 * quote, so it is never mistaken for a column; a future table that broke this
 * regularity would just get no backfills generated for its odd line, not corrupt
 * SQL, because the per-line regex below only ever matches the shape it expects.
 *
 * Every optional column also gets an `ALTER COLUMN ... DROP NOT NULL`. Neither the
 * `CREATE TABLE` nor the `ADD COLUMN` above can relax a column the replica already
 * holds as required, so a migration that made one optional (whole-drawer handover,
 * 2026-09-24: `pos_handovers.toUserId`) left every upgraded counter halted on
 * schema drift. Dropping NOT NULL from an already-optional column is a no-op.
 */
function addColumnBackfills(sql: string): string {
    return sql.replace(
        /CREATE TABLE IF NOT EXISTS "([A-Za-z0-9_]+)" \(\n([\s\S]*?)\n\);/g,
        (block: string, table: string, body: string) => {
            const alters: string[] = [];
            for (const line of body.split("\n")) {
                const col = /^ {4}"([A-Za-z0-9_]+)" (.+),$/.exec(line);
                if (!col) continue; // the CONSTRAINT line, or a blank separator line
                alters.push(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col[1]}" ${col[2]};`);
                if (!/\bNOT NULL\b/.test(col[2])) {
                    alters.push(`ALTER TABLE "${table}" ALTER COLUMN "${col[1]}" DROP NOT NULL;`);
                }
            }
            return alters.length ? `${block}\n${alters.join("\n")}` : block;
        },
    );
}

/**
 * Prisma renamed this flag in v7: \`--to-schema-datamodel\` became \`--to-schema\`.
 * Pinned here so a future rename fails loudly instead of silently producing nothing.
 */
function generate(): string {
    // Runs Prisma's CLI entry point directly under this same Node binary, rather than
    // going through `npx`. Two reasons: passing args through a shell does not escape
    // them (Node DEP0190), and Node 24 refuses to spawn a `.cmd` shim without a shell
    // at all (EINVAL), so `npx.cmd` is not an option either.
    const prismaCli = require.resolve("prisma/build/index.js");
    const sql = execFileSync(
        process.execPath,
        [prismaCli, "migrate", "diff", "--from-empty", "--to-schema", SCHEMA_DIR, "--script"],
        { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );

    // dotenvx and the Prisma config loader write banners to stdout, not stderr, so they
    // land in the middle of the SQL if left alone.
    const cleaned = sql
        .split(/\r?\n/)
        .filter((line) => !/^\s*(◇|◈|Loaded Prisma config)/.test(line))
        .join("\n")
        .trim();

    if (!cleaned.includes("CREATE TABLE")) {
        throw new Error("Generated SQL contains no CREATE TABLE — refusing to write it.");
    }
    return `${HEADER}\n${preSchemaFixes()}\n${makeIdempotent(cleaned)}\n${retiredIndexes()}\n${COUNTER_LOCAL_DDL}`;
}

/**
 * Indexes and constraints a replica may still carry from an OLDER version of this
 * file, and which the current schema no longer creates.
 *
 * This file is a from-empty snapshot, so on its own it can only ever ADD. When a
 * rule leaves the schema, a replica provisioned before that keeps enforcing it for
 * the life of the replica — a re-apply never removes it, and the counter's own
 * `schema_hash` check sees nothing wrong. That is harmless while no real row can
 * trip the old rule, and a halted till the moment one can. So an entry is listed the
 * release the removal starts to MATTER, not the release the rule was dropped.
 *
 * Only ever list an object this schema no longer creates — a name still emitted
 * above would be dropped and rebuilt on every counter start.
 */
const RETIRED_INDEXES: { name: string; why: string }[] = [
    {
        // Left the cloud DB in migration 20260914090000, when a counter was allowed
        // several extensions. It only ever indexed the WHOLE string, so two counters
        // had to hold identical lists to collide, and none did. Letting one extension
        // be shared across counters (parallel phone line, 2026-09-16) makes identical
        // the ordinary case, so on an old replica `pos_counters` would start failing.
        name: "pos_counters_epbxExtension_key",
        why: "an EPBX extension may now sit on several counters (parallel phone line)",
    },
    {
        // Migrations 20261110180000 / 20261110190000: attribute masters moved from
        // collection to group, and the key became unique on its own.
        name: "InvAttributeMaster_key_categoryId_key",
        why: "attribute masters are keyed by key alone (collection scoping removed)",
    },
    {
        name: "InvAttributeMaster_key_groupId_key",
        why: "attribute key is unique on its own",
    },
];

/**
 * Data fixes a replica needs BEFORE the schema below is applied — chiefly removing
 * rows that would make a newly added unique index fail to build. A failed build
 * aborts provisioning and leaves the till in live mode. Each fix mirrors the
 * cloud migration that made the same change, is idempotent, and skips a table
 * that does not exist yet (first run). The capture triggers fire on INSERT /
 * UPDATE only, so these deletes are not queued back to the cloud.
 */
const PRE_SCHEMA_FIXES: { table: string; sql: string; why: string }[] = [
    {
        // Migration 20261110190000: attribute key became unique on its own.
        table: "InvAttributeMaster",
        sql: `DELETE FROM "InvAttributeMaster" a USING "InvAttributeMaster" b WHERE a."key" = b."key" AND a."id" > b."id"`,
        why: "attribute key is unique on its own — keep the oldest row per key",
    },
];

function preSchemaFixes(): string {
    if (!PRE_SCHEMA_FIXES.length) return "";
    const body = PRE_SCHEMA_FIXES.map((f) =>
        `-- ${f.why}\nDO $$ BEGIN\n    IF to_regclass('public."${f.table}"') IS NOT NULL THEN\n        ${f.sql};\n    END IF;\nEND $$;`,
    ).join("\n");
    return `\n-- ── Pre-schema data fixes (PRE_SCHEMA_FIXES in scripts/gen-local-schema.ts) ──\n${body}\n`;
}

function retiredIndexes(): string {
    if (!RETIRED_INDEXES.length) return "";
    const drops = RETIRED_INDEXES.map((e) => `DROP INDEX IF EXISTS "${e.name}"; -- ${e.why}`).join("\n");
    return `\n-- ── Retired indexes (RETIRED_INDEXES in scripts/gen-local-schema.ts) ─────────\n${drops}\n`;
}

/**
 * One capture trigger per replicated table, generated from `prisma/sync-tables.json`.
 *
 * ── Why triggers rather than an interceptor in the app ───────────────────────
 * The outbox used to be filled by a `$extends` on the Prisma client, keyed off a
 * hand-written map of 14 models. It captured `args.data` — not the stored row, so
 * defaults and generated ids were missing — and only on bare `create`/`update`, so
 * `createMany`, `upsert`, nested writes and raw SQL all slipped past it. Three models
 * in the map were unreachable because a second hand-written list did not contain them,
 * and 27 models that the same list DID permit had no map entry at all, so they wrote
 * locally and never reached the cloud: products, customers, accounts, stock ledger,
 * loyalty ledger. A trigger sees the committed row whatever wrote it, and this list is
 * derived from the registry, so it cannot drift from the schema the way those did.
 *
 * ── Echo suppression is free, and this is why it must stay an ORDINARY trigger ──
 * The sync worker writes pulled rows inside `SET LOCAL session_replication_role =
 * replica` (sync-engine/lib/db.js). In that mode PostgreSQL fires only triggers marked
 * REPLICA or ALWAYS, so an ordinary trigger — `tgenabled = 'O'`, what plain CREATE
 * TRIGGER produces — does not fire, and rows arriving from the cloud are not queued
 * straight back to it. Never add ENABLE ALWAYS here, and never grant the app role
 * `SET ON PARAMETER session_replication_role`, or the app could silence its own capture.
 *
 * DROP-then-CREATE rather than a guard: it makes a changed primary key re-point the
 * trigger's arguments on the next provision instead of leaving stale ones behind.
 *
 * ── Tables that never push get no trigger ────────────────────────────────────
 * `push.ts` refuses the models in `NEVER_PUSH_MODELS` (users, sessions, permissions).
 * Capturing them anyway meant every local `User` update became a dead-lettered outbox
 * row that the status badge counted as a "sync error" for the life of the replica. So
 * those tables get the DROP alone — which also removes the trigger from a replica
 * provisioned before this rule existed.
 */
function outboxTriggers(): string {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")) as {
        tables: Record<string, { table: string; pk: string[]; cacheColumns?: string[] }>;
    };
    const skip = new Set(NEVER_PUSH_MODELS);

    const out: string[] = [];
    for (const [model, entry] of Object.entries(registry.tables)) {
        if (!entry.pk?.length) {
            throw new Error(`sync-tables.json: ${model} has no primary key — cannot capture it`);
        }
        // to_regclass keeps this tolerant of a registry entry whose table the schema
        // does not (yet) create, rather than aborting the whole provision.
        if (skip.has(model)) {
            out.push(
                `DO $$ BEGIN\n` +
                `    IF to_regclass('public."${entry.table}"') IS NOT NULL THEN\n` +
                `        DROP TRIGGER IF EXISTS "_outbox_capture" ON "${entry.table}"; -- never pushed\n` +
                `    END IF;\n` +
                `END $$;`,
            );
            continue;
        }
        // Primary-key columns first; then, for the handful of tables that carry a
        // running total, the marker and the total's columns (see `cacheColumns` in
        // gen-sync-registry.ts). One flat TG_ARGV, split by the marker inside.
        const cache = entry.cacheColumns ?? [];
        const args = [...entry.pk, ...(cache.length ? ["--cache", ...cache] : [])]
            .map((c) => `'${c}'`).join(", ");
        out.push(
            `DO $$ BEGIN\n` +
            `    IF to_regclass('public."${entry.table}"') IS NOT NULL THEN\n` +
            `        DROP TRIGGER IF EXISTS "_outbox_capture" ON "${entry.table}";\n` +
            `        CREATE TRIGGER "_outbox_capture" AFTER INSERT OR UPDATE ON "${entry.table}"\n` +
            `            FOR EACH ROW EXECUTE FUNCTION _outbox_capture(${args});\n` +
            `    END IF;\n` +
            `END $$;`,
        );
    }
    return `\n${out.join("\n")}\n`;
}

/**
 * Counter-local machinery that has no Prisma model, appended after the generated DDL.
 *
 * It lives here rather than in `localDbProvisioner.ts` for one reason: the provisioner
 * gates a re-apply on a hash of THIS file. Anything defined here is therefore covered
 * by that hash, so an app upgrade that changes it re-applies automatically. Anything
 * defined in the provisioner's own DDL constants is not, and has to be remembered by
 * hand — which is exactly how `_id_ranges` came to be created by the wrong role.
 *
 * ── Why `_apply_id_range` is a function and not client-side SQL ──────────────
 * Restarting a sequence requires OWNERSHIP of it, and creating a table requires
 * `CREATE ON SCHEMA`. `smx_app` deliberately has neither, so `electron/applyIdRanges.ts`
 * — which connects on the app URL — could do neither. Both calls failed, the errors
 * were swallowed, `_id_ranges` was never written, and the write gate that reads it
 * concluded "no confirmed range" forever. That single failure blocked every offline
 * write the counter could make.
 *
 * Granting `smx_app` sequence ownership would fix it and hand the app role DROP and
 * ALTER on every sequence at the same time. A `SECURITY DEFINER` function owned by
 * `postgres` gives it exactly the one operation it needs and nothing else.
 *
 * ── Why the sequence list is discovered, not passed in ───────────────────────
 * It used to be a hand-written list of 11 names. The schema has 79 models on
 * `@default(autoincrement())`, and under local-first writes the counter writes all of
 * them — so 68 sequences would have kept minting ids from 1, colliding head-on with
 * cloud ids. That does not crash: the push upserts, so it overwrites the wrong cloud
 * row. Reading the catalogue instead means a newly added table is covered the day it
 * appears, with nothing to remember.
 *
 * `deptype = 'a'` is the ownership link Postgres creates for a SERIAL column, so this
 * finds precisely the sequences behind `@default(autoincrement())`. Underscore-prefixed
 * tables are counter-local bookkeeping (`_outbox`, `_provision`, `_sync_state`) whose
 * ids must stay local and small — they are excluded.
 *
 * ── Why it never moves a sequence backwards inside its own block ─────────────
 * A plain `RESTART WITH block_start` is only safe the first time. Re-applying it after
 * the counter has already minted ids inside its block would hand out the same ids a
 * second time — locally-unique, silently duplicated once pushed. Taking the greater of
 * the block start and the sequence's current position makes a re-apply a no-op instead,
 * so the operation is safe to repeat and safe to run on an already-working counter.
 *
 * ── Why a sequence found ABOVE the block is pulled down into it ──────────────
 * A counter renumbered to a LOWER number gets a lower block, and its sequences are
 * still sitting in the old, higher one. "Never backwards" used to keep them there: the
 * function only warned "block exhausted" and left the sequence alone, `_id_ranges` was
 * stamped with the new block anyway, and the PC went on minting ids in a lane that no
 * longer belonged to it — the moment a new counter took the old number, the two shared
 * one lane and overwrote each other's rows in cloud. So a position above the block is
 * not kept: the sequence restarts at the block start, or above whatever this block
 * already holds (next note). The ids minted in the old lane are not reissued by this —
 * they live in the old block, not the new one.
 *
 * ── Why it also looks at the rows already in the table ───────────────────────
 * The sync pull inserts rows WITH their id (`INSERT … ON CONFLICT (id)` in
 * sync-engine/lib/pull.js), and Postgres does not advance a sequence for an id that
 * was supplied by hand. So after a reinstall the pull brings this counter's own
 * earlier rows back down — ids inside its block — while the sequence sits at the block
 * start, and the next local insert hits "Unique constraint failed on (id)". Seen live on
 * counter 93 (2026-09-06): tickets at 1920000000–1920000004, sequence at 1920000000.
 * Each sequence is therefore restarted above the highest id already present in the
 * table. Called after every pull cycle (sync-once.js) and at boot (localDbProvisioner)
 * so the gap never stays open.
 *
 * ── Why "highest id" means highest id INSIDE THIS BLOCK, never the table max ──
 * The replica also holds rows from cloud (below the block) and from other counters
 * (other blocks — counter 93 held 1930000010 from counter 94). Jumping past the table
 * max would park this counter's sequence inside another counter's block, and the two
 * would then overwrite each other's rows in cloud. Only rows in [block_start,
 * block_start + BLOCK_SIZE) count. BLOCK_SIZE is repeated here as a literal because
 * a plpgsql function cannot import `src/shared/lib/counter/idRange.ts`; keep the two
 * in step.
 */
const COUNTER_LOCAL_DDL = `
-- ── Counter-local: outbox of local writes awaiting push ─────────────────────
CREATE TABLE IF NOT EXISTS "_outbox" (
    id               SERIAL PRIMARY KEY,
    table_name       text        NOT NULL,
    row_pk           text        NOT NULL,
    row_key          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    operation        text        NOT NULL CHECK (operation IN ('create', 'update')),
    payload          jsonb       NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    pushed_at        timestamptz,
    idempotency_key  text        UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    error            text,
    attempts         integer     NOT NULL DEFAULT 0,
    next_attempt_at  timestamptz,
    dead_lettered_at timestamptz
);
-- Backfills for a replica provisioned before these columns existed. The generated
-- section above gets these automatically (see addColumnBackfills); this hand-written
-- section has to spell them out.
ALTER TABLE "_outbox" ADD COLUMN IF NOT EXISTS "row_key" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "_outbox" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "_outbox" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamptz;
ALTER TABLE "_outbox" ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamptz;
ALTER TABLE "_outbox" ALTER COLUMN "idempotency_key" SET DEFAULT gen_random_uuid()::text;

-- The flusher's queue scan: pending, not dead-lettered, not backing off, in id order.
CREATE INDEX IF NOT EXISTS "_outbox_pending_idx"
    ON "_outbox" (id) WHERE pushed_at IS NULL AND dead_lettered_at IS NULL;

-- ── Counter-local: reserved autoincrement id range ──────────────────────────
CREATE TABLE IF NOT EXISTS "_id_ranges" (
    only_row    boolean PRIMARY KEY DEFAULT true CHECK (only_row),
    block_start integer     NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION _apply_id_range(p_block_start integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    seq_name   text;
    tbl_name   text;
    col_name   text;
    block_end  bigint;
    cur_last   bigint;
    cur_called boolean;
    cur_next   bigint;
    in_block_max bigint;
    new_start  bigint;
    altered    integer := 0;
BEGIN
    IF p_block_start IS NULL OR p_block_start < 1 THEN
        RAISE EXCEPTION 'block start must be a positive integer, got %', p_block_start;
    END IF;
    -- BLOCK_SIZE in src/shared/lib/counter/idRange.ts; keep in step.
    block_end := p_block_start::bigint + 10000000 - 1;

    FOR seq_name, tbl_name, col_name IN
        SELECT s.oid::regclass::text, t.oid::regclass::text, a.attname
        FROM pg_class s
        JOIN pg_depend d
          ON d.objid = s.oid
         AND d.classid = 'pg_class'::regclass
         AND d.deptype = 'a'
        JOIN pg_class t ON t.oid = d.refobjid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        JOIN pg_namespace n ON n.oid = s.relnamespace
        WHERE s.relkind = 'S'
          AND n.nspname = 'public'
          AND t.relname NOT LIKE '\\_%'
    LOOP
        EXECUTE format('SELECT last_value, is_called FROM %s', seq_name)
            INTO cur_last, cur_called;
        cur_next := CASE WHEN cur_called THEN cur_last + 1 ELSE cur_last END;

        -- Rows already in this counter's block (pulled back after a reinstall).
        -- Rows outside it belong to cloud or another counter and must not count.
        EXECUTE format('SELECT max(%I) FROM %s WHERE %I BETWEEN $1 AND $2',
                       col_name, tbl_name, col_name)
            INTO in_block_max USING p_block_start::bigint, block_end;

        -- Never backwards inside the block, never below an id the table already
        -- holds. A position ABOVE the block is the old lane of a counter that was
        -- renumbered lower and is dropped (see the header note); one below it is the
        -- untouched default or a lower old lane, and GREATEST lifts it to the start.
        new_start := GREATEST(
            p_block_start::bigint,
            CASE WHEN cur_next <= block_end THEN cur_next ELSE 0 END,
            COALESCE(in_block_max, 0) + 1
        );

        IF new_start > block_end THEN
            RAISE WARNING 'id block exhausted for % (next % is past %)', tbl_name, new_start, block_end;
            CONTINUE;
        END IF;

        IF new_start <> cur_next THEN
            EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s', seq_name, new_start);
            altered := altered + 1;
        END IF;
    END LOOP;

    INSERT INTO "_id_ranges" (only_row, block_start)
    VALUES (true, p_block_start)
    ON CONFLICT (only_row)
    DO UPDATE SET block_start = EXCLUDED.block_start, applied_at = now();

    RETURN altered;
END;
$fn$;

REVOKE ALL ON FUNCTION _apply_id_range(integer) FROM PUBLIC;

-- ── Counter-local: outbox capture ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION _outbox_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_row     jsonb;
    v_key     jsonb  := '{}'::jsonb;
    v_pk      text;
    v_col     text;
    v_pk_cols text[] := '{}';
    v_cache   text[] := '{}';
    v_in_cache boolean := false;
BEGIN
    -- Prisma writes no-op updates in a few places; there is nothing to ship.
    IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
        RETURN NULL;
    END IF;

    -- Arguments: the primary-key columns, then optionally '--cache' followed by the
    -- table's running-total columns. One function serves every table.
    FOREACH v_col IN ARRAY TG_ARGV LOOP
        IF v_col = '--cache' THEN
            v_in_cache := true;
        ELSIF v_in_cache THEN
            v_cache := v_cache || v_col;
        ELSE
            v_pk_cols := v_pk_cols || v_col;
        END IF;
    END LOOP;

    -- A running total (stock, a gift card's balance) is rebuilt
    -- from the ledger on each side and never shipped as a change: an UPDATE that
    -- moved nothing else is not a write the cloud needs to hear about. Shipping it
    -- would put one outbox row per touched product behind every sale, and each of
    -- them would carry a total another machine may since have moved on from.
    -- updatedAt is ignored alongside: Prisma stamps it on every increment, so
    -- without that the comparison would never be equal.
    IF TG_OP = 'UPDATE' AND cardinality(v_cache) > 0
       AND (to_jsonb(OLD) - v_cache - 'updatedAt') = (to_jsonb(NEW) - v_cache - 'updatedAt') THEN
        RETURN NULL;
    END IF;

    v_row := to_jsonb(NEW);

    FOREACH v_col IN ARRAY v_pk_cols LOOP
        v_key := v_key || jsonb_build_object(v_col, v_row -> v_col);
    END LOOP;

    SELECT string_agg(v_row ->> u.col, chr(31) ORDER BY u.ord)
      INTO v_pk
      FROM unnest(v_pk_cols) WITH ORDINALITY AS u(col, ord);

    INSERT INTO "_outbox" (table_name, row_pk, row_key, operation, payload)
    VALUES (
        TG_TABLE_NAME,
        coalesce(v_pk, ''),
        v_key,
        CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END,
        v_row
    );

    -- Wake the flusher. NOTIFY is delivered only when this transaction COMMITS, and
    -- Postgres collapses identical notifications within one transaction, so a save
    -- that writes twelve rows wakes the flusher once, at the exact moment the rows
    -- become visible to it. No timer has to guess how long the commit takes.
    PERFORM pg_notify('outbox_changed', '');

    RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION _outbox_capture() FROM PUBLIC;
${outboxTriggers()}`;

/** Compare on content, not bytes: this repo checks out CRLF on Windows. */
function normalise(text: string): string {
    return text.replace(/\r\n/g, "\n").trim();
}

function main(): void {
    const check = process.argv.includes("--check");
    const generated = generate();

    // Counts the modelled tables only. COUNTER_LOCAL_DDL's own bookkeeping tables are
    // not Prisma models, and folding them in would make this number drift away from
    // the 113 the provisioner and sync registry both talk about.
    const tables = (generated.match(/^CREATE TABLE IF NOT EXISTS "[A-Za-z]/gm) ?? []).length;
    // Wrapped in a DO block for idempotency, so no longer at line start — see makeIdempotent().
    const enums = (generated.match(/CREATE TYPE "/g) ?? []).length;
    const triggers = (generated.match(/CREATE TRIGGER "_outbox_capture"/g) ?? []).length;

    // Every replicated table must carry a capture trigger, except the ones the push
    // side refuses anyway. A table in the registry with no trigger is otherwise a table
    // whose local writes never reach the cloud — the exact failure the old hand-written
    // model list produced, and just as quiet.
    const registryModels = Object.keys(
        (JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")) as { tables: Record<string, unknown> }).tables,
    );
    const expected = registryModels.filter((m) => !NEVER_PUSH_MODELS.includes(m)).length;
    if (triggers !== expected) {
        console.error(`[local-schema] TRIGGER GAP: ${triggers} capture triggers for ${expected} pushable registry tables.`);
        process.exit(1);
    }

    if (check) {
        if (!fs.existsSync(OUT_FILE)) {
            console.error("[local-schema] MISSING: resources/local-schema.sql has never been generated.");
            console.error("[local-schema] Run `pnpm db:local-schema` and commit the result.");
            process.exit(1);
        }
        if (normalise(fs.readFileSync(OUT_FILE, "utf8")) !== normalise(generated)) {
            console.error("[local-schema] DRIFT: resources/local-schema.sql no longer matches prisma/schema/.");
            console.error("[local-schema] A counter built from this commit would create the wrong tables.");
            console.error("[local-schema] Run `pnpm db:local-schema` and commit the result.");
            process.exit(1);
        }
        console.log(`[local-schema] OK — in sync (${tables} tables, ${enums} enums, ${triggers} capture triggers).`);
        return;
    }

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, generated, "utf8");
    console.log(`[local-schema] Wrote resources/local-schema.sql — ${tables} tables, ${enums} enums, ${triggers} capture triggers.`);
}

try {
    main();
} catch (err) {
    console.error("[local-schema] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
}
