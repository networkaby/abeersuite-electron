/**
 * The one-off repair scripts' common start: which database, which mode, and the
 * backup guard in front of a real write to live.
 *
 *   (no flags)              plan only — the transaction is rolled back
 *   --apply --rollback      run every write and its checks, then roll back
 *   --apply                 keep the writes; on live, only with a backup < 1 hour old
 *   --db <url>              another database (default DIRECT_URL)
 *
 * Every caller works inside ONE transaction on the client this hands back and
 * finishes with `finish(db, …)`, so a plan and a rehearsal can never leave a write.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";

const BACKUP_DIR = "D:/AbeerSuite/live-backups";

export interface Target {
    pool: Pool;
    db: PoolClient;
    /** Writes should run (`--apply`). */
    go: boolean;
    /** Writes run, then roll back (`--apply --rollback`). */
    rollback: boolean;
    /** Writes will be KEPT — the case every "must be true before writing" guard is for. */
    keeps: boolean;
    isLive: boolean;
}

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function newestBackupAgeMinutes(): number | null {
    if (!existsSync(BACKUP_DIR)) return null;
    const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".dump"));
    if (!files.length) return null;
    return (Date.now() - Math.max(...files.map((f) => statSync(join(BACKUP_DIR, f)).mtimeMs))) / 60_000;
}

/** Connect, print what is about to happen, refuse a live write without a fresh backup, and BEGIN. */
export async function openTarget(): Promise<Target> {
    const go = process.argv.includes("--apply");
    const rollback = process.argv.includes("--rollback");
    const url = arg("--db") ?? process.env.DIRECT_URL ?? "";
    if (!url) throw new Error("No database: pass --db <url> or set DIRECT_URL");
    const isLive = /supabase/.test(url);
    const u = new URL(url.replace(/[?&](sslmode|pgbouncer)=[^&]*/g, ""));
    console.log(`\nTarget: ${u.hostname}${u.pathname}${isLive ? "  (LIVE)" : ""}`);
    console.log(`Mode:   ${go ? (rollback ? "apply, then ROLL BACK" : "APPLY") : "plan only"}\n`);

    const keeps = go && !rollback;
    if (keeps && isLive) {
        const age = newestBackupAgeMinutes();
        if (age == null || age > 60) throw new Error("No live backup from the last hour — run `pnpm vyapar:backup-live` first.");
    }

    const pool = new Pool({ connectionString: u.toString(), ssl: isLive ? { rejectUnauthorized: false } : undefined });
    const db = await pool.connect();
    await db.query("begin");
    return { pool, db, go, rollback, keeps, isLive };
}

/** Commit only a kept apply; everything else rolls back. Always releases the connection. */
export async function finish(t: Target, ok: boolean, summary: string): Promise<void> {
    try {
        if (ok && t.keeps) {
            await t.db.query("commit");
            console.log(`\nDone — ${summary}.`);
        } else {
            await t.db.query("rollback");
            if (ok) {
                console.log(t.go
                    ? `\nWrote and verified ${summary}, then ROLLED BACK — nothing kept.`
                    : `\nPlan only — nothing written (${summary}). Add --apply to write.`);
            }
        }
    } finally {
        t.db.release();
        await t.pool.end();
    }
}
