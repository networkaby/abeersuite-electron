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
    return `${HEADER}\n${cleaned}\n`;
}

/** Compare on content, not bytes: this repo checks out CRLF on Windows. */
function normalise(text: string): string {
    return text.replace(/\r\n/g, "\n").trim();
}

function main(): void {
    const check = process.argv.includes("--check");
    const generated = generate();

    const tables = (generated.match(/^CREATE TABLE/gm) ?? []).length;
    const enums = (generated.match(/^CREATE TYPE/gm) ?? []).length;

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
