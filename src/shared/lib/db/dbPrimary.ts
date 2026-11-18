/**
 * Which of DB1 / DB2 is the PRIMARY — one Vercel setting, `NEXT_PUBLIC_DB_PRIMARY`.
 *
 * Owner, 2026-11-18: switches are rare (a quota running out, maintenance, a dead
 * database), so a switch is "Lock for switch" on Settings → Backup & Restore, then
 * change this setting and redeploy. No pointer table, no per-minute checks, no cache:
 * a deployment works on one database for its whole life.
 *
 *   NEXT_PUBLIC_DB_PRIMARY = DB1 | DB2   (unset = DB1)
 *
 * NEXT_PUBLIC_ so the browser bundle picks the same realtime project at build time.
 * The DESKTOP APP holds only the primary's URL (as DATABASE_URL, handed over by
 * `/api/counter/config`), so there this is always DB1 for Prisma; the office tells it
 * the real name as DB_PRIMARY_ID, which only realtime needs.
 *
 * `_db_switch` survives only as the nightly copy's bookkeeping row (copy started /
 * finished / failed), kept on the primary. It is outside the Prisma schema on purpose,
 * like `_sync_status`: infrastructure, not shop data, and a Prisma model would force a
 * counter release before every deploy (schemaGuard).
 */
import { Pool, type PoolClient } from "pg";
import { usesOfficeHandedDb } from "@/shared/lib/appModeCore";
import { dbTarget, isDualDb, otherDb, type DbId, type DbTarget } from "./dbTargets";

export const SWITCH_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "_db_switch" (
    only_row        boolean PRIMARY KEY DEFAULT true CHECK (only_row),
    primary_db      text NOT NULL,
    switched_at     timestamptz NOT NULL DEFAULT now(),
    copy_started_at timestamptz,
    copy_into       text,
    copy_file       text,
    copied_at       timestamptz,
    copy_failed_at  timestamptz
)`;

export interface SwitchRow {
    copy_started_at: Date | null;
    copy_into: string | null;
    copy_file: string | null;
    copied_at: Date | null;
    copy_failed_at: Date | null;
}

/** The primary for this deployment. DB2 only when it is named AND configured. */
export function currentPrimary(): DbId {
    if (usesOfficeHandedDb()) return "DB1";
    const named = process.env.NEXT_PUBLIC_DB_PRIMARY?.trim().toUpperCase();
    if (named === "DB2") {
        if (dbTarget("DB2")) return "DB2";
        console.warn("[dbPrimary] NEXT_PUBLIC_DB_PRIMARY=DB2 but DATABASE_URL_2 is not set — using DB1.");
    }
    return "DB1";
}

/**
 * The primary for picking a REALTIME project. The desktop app holds one URL, so the office
 * hands it `DB_PRIMARY_ID` (`/api/counter/config`); everywhere else, `currentPrimary()`.
 */
export function realtimePrimary(): DbId {
    if (usesOfficeHandedDb()) return process.env.DB_PRIMARY_ID?.trim() === "DB2" ? "DB2" : "DB1";
    return currentPrimary();
}

/**
 * The realtime pair (Supabase URL + publishable key) that goes with a database.
 * In the desktop app (counter or not, replica or not): only what the office handed it (`REALTIME_URL` / `REALTIME_KEY`,
 * `/api/counter/config`) — nothing baked, so a switch on Vercel needs no rebuild.
 * Elsewhere: that database's own `NEXT_PUBLIC_SUPABASE_*_n`. Null when not set.
 */
export function primaryRealtimePair(id: DbId = realtimePrimary()): { url: string; key: string } | null {
    if (usesOfficeHandedDb()) {
        const url = process.env.REALTIME_URL?.trim();
        const key = process.env.REALTIME_KEY?.trim();
        return url && key ? { url, key } : null;
    }
    const n = id === "DB2" ? "2" : "1";
    const url = process.env[`NEXT_PUBLIC_SUPABASE_URL_${n}`]?.trim();
    const key = process.env[`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_${n}`]?.trim();
    return url && key ? { url, key } : null;
}

/** Primary and standby targets. Standby is null with one database. */
export async function primaryAndStaging(): Promise<{ primary: DbTarget; staging: DbTarget | null }> {
    const id = currentPrimary();
    const primary = dbTarget(id);
    if (!primary) throw new Error(`${id} is not configured.`);
    return { primary, staging: isDualDb() ? dbTarget(otherDb(id)) : null };
}

// ── Direct connections for the lock, the copy bookkeeping and the status card ──
// Opened only when someone uses those (never on the request path), released at once.

const g = globalThis as unknown as { __dbMetaPools?: Partial<Record<DbId, Pool>> };
const pools: Partial<Record<DbId, Pool>> = (g.__dbMetaPools ??= {});

function metaPool(t: DbTarget): Pool {
    let pool = pools[t.id];
    if (!pool) {
        const url = t.direct.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
        pool = new Pool({
            connectionString: url,
            ssl: /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) ? false : { rejectUnauthorized: false },
            max: 1,
            connectionTimeoutMillis: 8_000,
            idleTimeoutMillis: 5_000,
        });
        pool.on("error", (err) => console.warn(`[dbPrimary] ${t.id} idle client error:`, err.message));
        pools[t.id] = pool;
    }
    return pool;
}

/** Runs `fn` on `id`'s database. Writes must open their own `BEGIN READ WRITE` — the standby is read-only. */
export async function withDb<T>(id: DbId, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const t = dbTarget(id);
    if (!t) throw new Error(`${id} is not configured.`);
    const client = await metaPool(t).connect();
    try {
        return await fn(client);
    } finally {
        client.release();
    }
}

/**
 * Is `id` locked read-only? Read from the DATABASE's saved setting, not the session's:
 * a session opened before a lock keeps the old value, so `current_setting(...)` on a
 * reused connection says "writable" right after a lock (found in the 2026-11-18 test).
 */
export const DB_READ_ONLY_SQL = `
SELECT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
               WHERE d.datname = current_database() AND s.setrole = 0
                 AND 'default_transaction_read_only=on' = ANY (s.setconfig)) AS ro`;

/** The copy-bookkeeping row in `id`, or null when the table does not exist yet. */
export async function readSwitchRow(id: DbId): Promise<SwitchRow | null> {
    return withDb(id, async (c) => {
        try {
            const r = await c.query<SwitchRow>(`SELECT * FROM "_db_switch" WHERE only_row`);
            return r.rows[0] ?? null;
        } catch (e) {
            if ((e as { code?: string }).code === "42P01") return null;
            throw e;
        }
    });
}
