/**
 * Take a fresh backup of the LIVE Supabase database, and prove it is readable.
 *
 * This runs immediately before the migration is pushed, and the file it writes is
 * the only way back. A backup nobody has opened is a hope, not a rollback — so it
 * is listed with `pg_restore --list` afterwards and the table count is reported.
 * That catches a truncated or half-written dump, which is exactly the failure that
 * looks fine until the day it is needed. An earlier Vyapar backup in this same
 * migration was truncated mid-write and looked perfectly plausible.
 *
 * The password is passed through PGPASSWORD in the child's environment, never on
 * the command line, where it would be visible to anything reading the process list.
 *
 *   pnpm vyapar:backup-live
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PG_BIN = "D:/Program Files/PostgreSQL/17/bin";
const OUT_DIR = "D:/AbeerSuite/live-backups";

function main(): void {
    const raw = process.env.DIRECT_URL ?? "";
    if (!/supabase/.test(raw)) throw new Error("DIRECT_URL is not Supabase — nothing to back up");

    const u = new URL(raw);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, `live-before-vyapar-push-${stamp}.dump`);

    const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
    const conn = ["-h", u.hostname, "-p", u.port || "5432", "-U", decodeURIComponent(u.username),
                  "-d", u.pathname.replace(/^\//, "") || "postgres"];

    console.log(`\nbacking up ${u.hostname}:${u.port}${u.pathname}`);
    console.log(`        to ${out}\n`);

    const dump = spawnSync(join(PG_BIN, "pg_dump.exe"),
        [...conn, "--format=custom", "--no-owner", "--no-privileges", "--schema=public", "--file", out],
        { env, stdio: "inherit" });
    if (dump.status !== 0) throw new Error(`pg_dump failed with status ${dump.status}`);

    const size = statSync(out).size;
    console.log(`\nwrote ${(size / 1024 / 1024).toFixed(1)} MB`);

    // Read it back. A dump that cannot be listed cannot be restored.
    const list = spawnSync(join(PG_BIN, "pg_restore.exe"), ["--list", out],
        { env, stdio: "pipe", encoding: "utf8" });
    if (list.status !== 0) throw new Error(`the dump could not be read back — pg_restore --list failed`);
    const lines = String(list.stdout ?? "").split("\n");
    const tables = lines.filter((l) => / TABLE DATA /.test(l)).length;
    console.log(`verified readable — ${tables} table(s) of data inside\n`);
    if (tables < 50) throw new Error(`only ${tables} tables in the dump — that is too few to be a whole database`);
}

main();
