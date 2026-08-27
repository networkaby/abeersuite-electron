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
    return `${HEADER}\n${makeIdempotent(cleaned)}\n`;
}

/** Compare on content, not bytes: this repo checks out CRLF on Windows. */
function normalise(text: string): string {
    return text.replace(/\r\n/g, "\n").trim();
}

function main(): void {
    const check = process.argv.includes("--check");
    const generated = generate();

    const tables = (generated.match(/^CREATE TABLE/gm) ?? []).length;
    // Wrapped in a DO block for idempotency, so no longer at line start — see makeIdempotent().
    const enums = (generated.match(/CREATE TYPE "/g) ?? []).length;

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
        console.log(`[local-schema] OK — in sync (${tables} tables, ${enums} enums).`);
        return;
    }

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, generated, "utf8");
    console.log(`[local-schema] Wrote resources/local-schema.sql — ${tables} tables, ${enums} enums.`);
}

try {
    main();
} catch (err) {
    console.error("[local-schema] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
}
