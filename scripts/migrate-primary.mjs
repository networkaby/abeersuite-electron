#!/usr/bin/env node
/**
 * `prisma migrate deploy` on whichever database is PRIMARY — run by `vercel-build`.
 *
 * DB1 = DIRECT_URL_1 / DATABASE_URL_1 (old names DIRECT_URL / DATABASE_URL as fallback),
 * DB2 = DIRECT_URL_2 / DATABASE_URL_2 — see src/shared/lib/db/dbTargets.ts.
 * The primary is the `_db_switch` row in both databases, latest `switched_at` wins, no row
 * = DB1 (src/shared/lib/db/dbPrimary.ts). Staging is never migrated: it is read-only and
 * takes the new schema from the nightly copy; the switch refuses until both match.
 *
 * Plain .mjs on purpose: it runs before the build, with only node_modules to lean on.
 * Fails the build when two databases are set and neither answers — migrating a guess
 * could put the schema on staging and leave the primary behind.
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

function target(n) {
    const pooled = clean(process.env[`DATABASE_URL_${n}`]) ?? (n === 1 ? clean(process.env.DATABASE_URL) : undefined);
    const direct =
        clean(process.env[`DIRECT_URL_${n}`]) ?? (n === 1 ? clean(process.env.DIRECT_URL) : undefined) ?? pooled;
    return direct ? { id: `DB${n}`, direct } : null;
}

async function readRow(t) {
    const url = t.direct.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
    const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
    const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
    await client.connect();
    try {
        const r = await client.query(`SELECT primary_db, switched_at FROM "_db_switch" WHERE only_row`);
        return r.rows[0] ?? null;
    } catch (e) {
        if (e.code === "42P01") return null; // never switched
        throw e;
    } finally {
        await client.end().catch(() => {});
    }
}

const targets = [target(1), target(2)].filter(Boolean);
if (targets.length === 0) {
    console.error("[migrate-primary] No database URL set (DIRECT_URL_1 / DATABASE_URL_1 or DIRECT_URL / DATABASE_URL).");
    process.exit(1);
}

let primary = targets[0];
if (targets.length === 2) {
    const answers = await Promise.allSettled(targets.map(readRow));
    if (answers.every((a) => a.status === "rejected")) {
        console.error("[migrate-primary] Neither DB1 nor DB2 answered — cannot tell which is primary.");
        for (const a of answers) console.error("  ", a.reason?.message);
        process.exit(1);
    }
    let best = null;
    for (const a of answers) {
        const row = a.status === "fulfilled" ? a.value : null;
        if (!row || (row.primary_db !== "DB1" && row.primary_db !== "DB2")) continue;
        const at = new Date(row.switched_at).getTime();
        if (!best || at > best.at) best = { id: row.primary_db, at };
    }
    primary = targets.find((t) => t.id === (best?.id ?? "DB1")) ?? targets[0];
}

console.log(`[migrate-primary] migrating ${primary.id} (primary)`);
const run = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DIRECT_URL: primary.direct },
});
process.exit(run.status ?? 1);
