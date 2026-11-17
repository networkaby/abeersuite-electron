#!/usr/bin/env node
/**
 * `prisma migrate deploy` on the PRIMARY — run by `vercel-build`.
 *
 * The primary is the Vercel setting NEXT_PUBLIC_DB_PRIMARY (DB1 | DB2, unset = DB1);
 * see src/shared/lib/db/dbPrimary.ts.
 *   DB1 = DIRECT_URL_1 / DATABASE_URL_1,  DB2 = DIRECT_URL_2 / DATABASE_URL_2.
 *
 * Step 2 of a switch is "change the setting, redeploy", so this is also where the new
 * primary is OPENED: the standby is kept read-only, and the database named here is made
 * writable before migrating. The old primary was locked read-only by step 1 ("Lock for
 * switch") and stays so — it is the standby now.
 *
 * Plain .mjs on purpose: it runs before the build, with only node_modules to lean on.
 */
import { spawnSync } from "node:child_process";
import pg from "pg";

try {
    const dotenv = await import("dotenv");
    dotenv.config({ path: ".env.local" });
    dotenv.config({ path: ".env" });
} catch {
    /* Vercel: the environment is already set */
}

const clean = (v) => (v && v.trim()) || undefined;
const id = clean(process.env.NEXT_PUBLIC_DB_PRIMARY)?.toUpperCase() === "DB2" ? "DB2" : "DB1";
const n = id.slice(2);
const direct = clean(process.env[`DIRECT_URL_${n}`]) ?? clean(process.env[`DATABASE_URL_${n}`]);
if (!direct) {
    console.error(`[migrate-primary] NEXT_PUBLIC_DB_PRIMARY is ${id} but DIRECT_URL_${n} / DATABASE_URL_${n} is not set.`);
    process.exit(1);
}

// Open the primary (a no-op when it is already writable).
{
    const url = direct.replace(/[?&](sslmode|pgbouncer)=[^&]*/g, "").replace(/[?&]$/, "");
    const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
    const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
    await client.connect();
    try {
        const ro = await client.query("SELECT current_setting('default_transaction_read_only') AS ro");
        if (ro.rows[0]?.ro === "on") {
            await client.query("BEGIN READ WRITE");
            await client.query(
                "DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET default_transaction_read_only = off', current_database()); END $$",
            );
            await client.query("COMMIT");
            console.log(`[migrate-primary] ${id} was read-only (locked or standby) — made writable as the primary.`);
        }
    } finally {
        await client.end().catch(() => {});
    }
}

console.log(`[migrate-primary] migrating ${id} (primary)`);
const run = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, PRISMA_MIGRATE_URL: direct },
});
process.exit(run.status ?? 1);
