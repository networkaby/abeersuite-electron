/**
 * Load a live-Supabase `pg_dump` archive into the LOCAL migration database.
 *
 * Step 0 of the Vyapar migration: the importer has to MATCH Vyapar's items and
 * parties against the masters AbeerSuite already holds — months of hand-corrected
 * names, categories, brands and HSN codes. Without those present every row looks
 * new, everything is created, and the corrections are lost. So live comes down
 * once, and all the work happens against the copy.
 *
 * Restoring a full custom-format archive (schema + data + constraints, in pg_dump's
 * own dependency order) is safer than a `--data-only` load into an already-pushed
 * schema, where table order can trip foreign keys. So the target is dropped and
 * recreated. Run `prisma db push` afterwards to bring the restored schema up to
 * whatever the current Prisma schema says.
 *
 * Two rails, because this drops a database:
 *   • it refuses any target that is not localhost
 *   • it refuses a target that already holds rows, unless --force
 *
 * The password is read from DIRECT_URL and passed to pg_restore through PGPASSWORD
 * in the child's environment — never on a command line, where it would surface in
 * process lists and shell history.
 *
 *   pnpm vyapar:restore-local -- <path-to.dump> [--force]
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Pool } from "pg";

/** Where the PostgreSQL 17 client tools live on this machine. */
const PG_BIN_CANDIDATES = [
    "D:\\Program Files\\PostgreSQL\\17\\bin",
    "C:\\Program Files\\PostgreSQL\\17\\bin",
];

function pgBin(): string {
    for (const d of PG_BIN_CANDIDATES) if (existsSync(`${d}\\pg_restore.exe`)) return d;
    throw new Error(`pg_restore.exe not found in: ${PG_BIN_CANDIDATES.join(", ")}`);
}

/** Quote an identifier — DROP/CREATE DATABASE accept no bound parameters. */
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function main(): Promise<void> {
    const dump = process.argv[2];
    const force = process.argv.includes("--force");
    if (!dump || !existsSync(dump)) throw new Error(`dump file not found: ${dump ?? "(no path given)"}`);

    const raw = (process.env.DIRECT_URL_1 ?? process.env.DATABASE_URL_1 ?? "").replace(/[?&]sslmode=[^&]*/g, "");
    if (!raw) throw new Error("no DIRECT_URL / DATABASE_URL — is .env.local set up?");

    const u = new URL(raw);
    const dbName = u.pathname.replace(/^\//, "");
    const host = u.hostname;
    const port = u.port || "5432";
    const user = decodeURIComponent(u.username);
    const password = decodeURIComponent(u.password);

    // Rail 1 — never drop anything that is not on this machine.
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
        throw new Error(`REFUSING: target is ${host}, not localhost. This script drops the database.`);
    }
    console.log(`target : ${user}@${host}:${port}/${dbName}`);
    console.log(`dump   : ${dump}`);

    const admin = new Pool({
        connectionString: `postgresql://${u.username}:${u.password}@${host}:${port}/postgres`,
        ssl: false, max: 1,
    });

    // Rail 2 — never silently discard a database someone has been working in.
    const exists = await admin.query(`select 1 from pg_database where datname = $1`, [dbName]);
    if (exists.rowCount) {
        const probe = new Pool({ connectionString: raw, ssl: false, max: 1 });
        const { rows } = await probe.query(
            `select coalesce(sum(n_live_tup), 0)::int n from pg_stat_user_tables where schemaname = 'public'`,
        );
        await probe.end();
        const live = Number(rows[0].n);
        console.log(`holds  : ${live} rows`);
        if (live > 0 && !force) {
            await admin.end();
            throw new Error(`REFUSING: ${dbName} already holds ${live} rows. Pass --force to drop and replace it.`);
        }

        console.log("dropping and recreating …");
        // Open sessions (a dev server, pgAdmin, a stray script) block DROP DATABASE,
        // so evict them first rather than failing halfway.
        await admin.query(
            `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
            [dbName],
        );
        await admin.query(`drop database ${ident(dbName)}`);
    }
    await admin.query(`create database ${ident(dbName)}`);
    await admin.end();

    // `--no-owner` / `--no-privileges`: the dump's roles are Supabase's and do not
    // exist here, so without these every GRANT and ALTER OWNER becomes an error.
    console.log("restoring …");
    const r = spawnSync(`${pgBin()}\\pg_restore.exe`, [
        "--dbname", dbName, "--host", host, "--port", port, "--username", user,
        "--no-owner", "--no-privileges", "--no-comments", dump,
    ], { env: { ...process.env, PGPASSWORD: password }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

    const errs = (r.stderr ?? "").split("\n").filter((l) => l.trim());
    if (errs.length) {
        console.log(`\npg_restore reported ${errs.length} line(s):`);
        for (const l of errs.slice(0, 15)) console.log(`  ${l}`);
        if (errs.length > 15) console.log(`  … ${errs.length - 15} more`);
    }

    const pool = new Pool({ connectionString: raw, ssl: false, max: 1 });
    await pool.query("analyze");
    const top = await pool.query(
        `select relname, n_live_tup::int n from pg_stat_user_tables
         where schemaname = 'public' and n_live_tup > 0 order by n desc limit 15`,
    );
    const tot = await pool.query(
        `select coalesce(sum(n_live_tup), 0)::int n, count(*)::int t from pg_stat_user_tables
         where schemaname = 'public' and n_live_tup > 0`,
    );
    await pool.end();

    console.log(`\nrestored: ${tot.rows[0].n} rows across ${tot.rows[0].t} non-empty tables`);
    for (const row of top.rows) console.log(`  ${String(row.relname).padEnd(26)} ${String(row.n).padStart(7)}`);
    console.log("\nNext: `npx prisma db push` to bring the restored schema up to the current Prisma schema.\n");
}

main().catch((e: Error) => { console.error(`\n${e.message}\n`); process.exit(1); });
