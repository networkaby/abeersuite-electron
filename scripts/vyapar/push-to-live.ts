/**
 * Push the migrated books from local Postgres into the LIVE Supabase project.
 *
 * This is the irreversible step. It TRUNCATES every table in live's public schema
 * and reloads them from local, so the backup taken immediately beforehand is the
 * only way back — run `pnpm vyapar:backup-live` first, which also reads its own
 * output back to prove it is restorable.
 *
 * ── Why a data-only load, and why triggers come off ─────────────────────────
 * Only `public` is touched. A full-cluster dump would trample Supabase's own
 * `auth`, `storage` and `extensions` schemas and break the project.
 *
 * `pg_dump --data-only` emits tables in alphabetical order, not dependency order,
 * so a straight restore trips foreign keys almost immediately. The fix is
 * `session_replication_role = replica` for the duration, which suspends FK and
 * trigger enforcement — verified available on this project, since the `postgres`
 * role owns all 117 tables. Constraints come back on at the end whatever happens,
 * in a `finally`, because leaving a live database with its foreign keys asleep
 * would be far worse than a failed load.
 *
 * ── Guards ──────────────────────────────────────────────────────────────────
 *   • refuses unless DIRECT_URL is genuinely Supabase
 *   • refuses unless --yes-replace-live is passed, so it cannot run by accident
ature *   • refuses if no backup exists from the last hour
 *     that do not add up)
 *   • refuses if no backup exists from the last hour
 *
 *   pnpm vyapar:push-to-live                        # dry run — plan only
 *   pnpm vyapar:push-to-live -- --yes-replace-live
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Pool } from "pg";

const PG_BIN = "D:/Program Files/PostgreSQL/17/bin";
const BACKUP_DIR = "D:/AbeerSuite/live-backups";
const LOCAL = "postgresql://postgres:postgres@localhost:5432/abeersuite_migrate";

function newestBackupAgeMinutes(): number | null {
    if (!existsSync(BACKUP_DIR)) return null;
    const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".dump"));
    if (!files.length) return null;
    const newest = Math.max(...files.map((f) => statSync(join(BACKUP_DIR, f)).mtimeMs));
    return (Date.now() - newest) / 60_000;
}

async function main(): Promise<void> {
    const go = process.argv.includes("--yes-replace-live");
    const raw = process.env.DIRECT_URL ?? "";
    if (!/supabase/.test(raw)) throw new Error("DIRECT_URL is not Supabase — refusing");

    const u = new URL(raw.replace(/[?&]sslmode=[^&]*/g, ""));
    const target = `${u.hostname}:${u.port}${u.pathname}`;
    console.log(`\n  FROM  localhost:5432/abeersuite_migrate`);
    console.log(`    TO  ${target}   ← LIVE\n`);

    const age = newestBackupAgeMinutes();
    if (age == null) throw new Error(`no backup in ${BACKUP_DIR} — run pnpm vyapar:backup-live first`);
    console.log(`  newest live backup: ${age.toFixed(0)} minute(s) old`);
    if (age > 60) throw new Error(`the newest backup is ${age.toFixed(0)} minutes old — take a fresh one`);

    const local = new Pool({ connectionString: LOCAL, ssl: false, max: 1 });
    const live = new Pool({ connectionString: u.toString(), ssl: { rejectUnauthorized: false }, max: 1 });

    const lc = (await local.query(`select
        (select count(*)::int from "UniversalVoucher") v, (select count(*)::int from "InvProduct") p,
        (select count(*)::int from "Person") n, (select count(*)::int from "Account") a`)).rows[0];
    const rc = (await live.query(`select
        (select count(*)::int from "UniversalVoucher") v, (select count(*)::int from "InvProduct") p,
        (select count(*)::int from "Person") n, (select count(*)::int from "Account") a`)).rows[0];
    console.log(`  local   ${lc.v} vouchers · ${lc.p} products · ${lc.n} persons · ${lc.a} accounts`);
    console.log(`  live    ${rc.v} vouchers · ${rc.p} products · ${rc.n} persons · ${rc.a} accounts   ← all of this is replaced`);

    const tables = (await live.query(
        `select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows.map((r) => String(r.tablename));
    console.log(`\n  ${tables.length} table(s) in live's public schema will be truncated and reloaded`);

    if (!go) {
        console.log(`\nDry run. Re-run with --yes-replace-live to actually replace live.\n`);
        await local.end(); await live.end(); return;
    }

    // ── Dump local ──────────────────────────────────────────────────────────
    const dumpFile = join(tmpdir(), `vyapar-push-${Date.now()}.sql`);
    console.log(`\n  dumping local data → ${dumpFile}`);
    const dump = spawnSync(join(PG_BIN, "pg_dump.exe"),
        ["-h", "localhost", "-p", "5432", "-U", "postgres", "-d", "abeersuite_migrate",
         "--data-only", "--schema=public", "--no-owner", "--no-privileges", "--file", dumpFile],
        { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "inherit" });
    if (dump.status !== 0) throw new Error("pg_dump of the local database failed");
    console.log(`  dumped ${(statSync(dumpFile).size / 1024 / 1024).toFixed(1)} MB`);

    // ── Replace live ────────────────────────────────────────────────────────
    // Constraints off for the load, and back on in `finally` no matter what —
    // a live database left with its foreign keys asleep is worse than a failure.
    try {
        console.log(`  suspending constraint enforcement`);
        await live.query(`set session_replication_role = replica`);

        const list = tables.map((t) => `"public"."${t}"`).join(", ");
        console.log(`  truncating ${tables.length} table(s)`);
        await live.query(`truncate table ${list} restart identity cascade`);

        console.log(`  loading …`);
        const load = spawnSync(join(PG_BIN, "psql.exe"),
            ["-h", u.hostname, "-p", u.port || "5432", "-U", decodeURIComponent(u.username),
             "-d", u.pathname.replace(/^\//, "") || "postgres",
             "-v", "ON_ERROR_STOP=1", "--single-transaction",
             "-c", "set session_replication_role = replica",
             "-f", dumpFile],
            { env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) }, stdio: "inherit" });
        if (load.status !== 0) throw new Error(`the load FAILED — live is now EMPTY. Restore from ${BACKUP_DIR} immediately.`);
    } finally {
        await live.query(`set session_replication_role = origin`);
        console.log(`  constraint enforcement restored`);
    }

    const after = (await live.query(`select
        (select count(*)::int from "UniversalVoucher") v, (select count(*)::int from "InvProduct") p,
        (select count(*)::int from "Person") n, (select count(*)::int from "Account") a`)).rows[0];
    console.log(`\n  live now  ${after.v} vouchers · ${after.p} products · ${after.n} persons · ${after.a} accounts`);
    const ok = after.v === lc.v && after.p === lc.p && after.n === lc.n && after.a === lc.a;
    console.log(ok ? `\n✓ live matches local\n` : `\n⚠ counts differ from local — investigate before anyone uses the system\n`);

    await local.end();
    await live.end();
    if (!ok) process.exit(1);
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
