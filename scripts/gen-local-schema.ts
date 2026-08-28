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
 *   1. Replay committed migrations — impossible here. This repo has NO
 *      `prisma/migrations/` directory; it is `db push`-based, so there is no history.
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

    return addColumnBackfills(out);
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
    return `${HEADER}\n${makeIdempotent(cleaned)}\n${COUNTER_LOCAL_DDL}`;
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
 */
function outboxTriggers(): string {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")) as {
        tables: Record<string, { table: string; pk: string[] }>;
    };

    const out: string[] = [];
    for (const [model, entry] of Object.entries(registry.tables)) {
        if (!entry.pk?.length) {
            throw new Error(`sync-tables.json: ${model} has no primary key — cannot capture it`);
        }
        const args = entry.pk.map((c) => `'${c}'`).join(", ");
        // to_regclass keeps this tolerant of a registry entry whose table the schema
        // does not (yet) create, rather than aborting the whole provision.
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
 * ── Why it never moves a sequence backwards ──────────────────────────────────
 * A plain `RESTART WITH block_start` is only safe the first time. Re-applying it after
 * the counter has already minted ids inside its block would hand out the same ids a
 * second time — locally-unique, silently duplicated once pushed. Taking the greater of
 * the block start and the sequence's current position makes a re-apply a no-op instead,
 * so the operation is safe to repeat and safe to run on an already-working counter.
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
    seq_name  text;
    cur_last  bigint;
    cur_called boolean;
    new_start bigint;
    altered   integer := 0;
BEGIN
    IF p_block_start IS NULL OR p_block_start < 1 THEN
        RAISE EXCEPTION 'block start must be a positive integer, got %', p_block_start;
    END IF;

    FOR seq_name IN
        SELECT s.oid::regclass::text
        FROM pg_class s
        JOIN pg_depend d
          ON d.objid = s.oid
         AND d.classid = 'pg_class'::regclass
         AND d.deptype = 'a'
        JOIN pg_class t ON t.oid = d.refobjid
        JOIN pg_namespace n ON n.oid = s.relnamespace
        WHERE s.relkind = 'S'
          AND n.nspname = 'public'
          AND t.relname NOT LIKE '\\_%'
    LOOP
        EXECUTE format('SELECT last_value, is_called FROM %s', seq_name)
            INTO cur_last, cur_called;

        -- Never backwards: see the header note on re-application.
        new_start := GREATEST(
            p_block_start::bigint,
            CASE WHEN cur_called THEN cur_last + 1 ELSE cur_last END
        );

        EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s', seq_name, new_start);
        altered := altered + 1;
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
    v_row jsonb;
    v_key jsonb := '{}'::jsonb;
    v_pk  text;
    v_col text;
BEGIN
    -- Prisma writes no-op updates in a few places; there is nothing to ship.
    IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
        RETURN NULL;
    END IF;

    v_row := to_jsonb(NEW);

    -- PK column names arrive as trigger arguments, so one function serves every
    -- table, compound keys included.
    FOREACH v_col IN ARRAY TG_ARGV LOOP
        v_key := v_key || jsonb_build_object(v_col, v_row -> v_col);
    END LOOP;

    SELECT string_agg(v_row ->> u.col, chr(31) ORDER BY u.ord)
      INTO v_pk
      FROM unnest(TG_ARGV) WITH ORDINALITY AS u(col, ord);

    INSERT INTO "_outbox" (table_name, row_pk, row_key, operation, payload)
    VALUES (
        TG_TABLE_NAME,
        coalesce(v_pk, ''),
        v_key,
        CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END,
        v_row
    );

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

    // Every replicated table must carry a capture trigger. A table in the registry with
    // no trigger is a table whose local writes never reach the cloud — the exact
    // failure the old hand-written model list produced, and just as quiet.
    const registryCount = Object.keys(
        (JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")) as { tables: Record<string, unknown> }).tables,
    ).length;
    if (triggers !== registryCount) {
        console.error(`[local-schema] TRIGGER GAP: ${triggers} capture triggers for ${registryCount} registry tables.`);
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
