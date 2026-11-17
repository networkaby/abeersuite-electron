/**
 * Which of DB1 / DB2 is the PRIMARY right now.
 *
 * The answer is a one-row table, `_db_switch`, kept in BOTH databases and written to both
 * on every switch. Neither `.env` nor a redeploy is involved, so a switch reaches every
 * server within `TTL_MS`. Each row carries `switched_at`; when the two disagree (one was
 * down during a switch) the later one wins, so any single reachable database is enough
 * to answer.
 *
 * The table is outside the Prisma schema on purpose, like `_sync_status` and
 * `_id_ranges`: it is infrastructure, not shop data, it must exist in a database before
 * the app's own tables are trusted there, and as a Prisma model it would force a counter
 * release before every deploy (schemaGuard). It IS in the public schema, so the nightly
 * dump carries the primary's row into staging — after a copy the two always agree.
 *
 * Single-database mode (no DATABASE_URL_2): everything here answers "DB1" at once and never
 * touches the network.
 */
import { Pool, type PoolClient } from "pg";
import { dbTarget, isDualDb, otherDb, type DbId, type DbTarget } from "./dbTargets";

const TTL_MS = 60_000;

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
    primary_db: string;
    switched_at: Date;
    copy_started_at: Date | null;
    copy_into: string | null;
    copy_file: string | null;
    copied_at: Date | null;
    copy_failed_at: Date | null;
}

type Cache = { primary: DbId; checkedAt: number; inflight: Promise<DbId> | null };

// globalThis, not module scope: instrumentation.ts and the route handlers do not
// reliably share module instances (see prismaClient.ts), but they share the process.
const g = globalThis as unknown as { __dbPrimary?: Cache; __dbMetaPools?: Partial<Record<DbId, Pool>> };
const cache: Cache = (g.__dbPrimary ??= { primary: "DB1", checkedAt: 0, inflight: null });
const pools: Partial<Record<DbId, Pool>> = (g.__dbMetaPools ??= {});

function isLocalHost(url: string): boolean {
    return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

/** A tiny pool per database for this file's own queries — never Prisma's. */
function metaPool(t: DbTarget): Pool {
    let pool = pools[t.id];
    if (!pool) {
        const url = t.direct.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
        pool = new Pool({
            connectionString: url,
            ssl: isLocalHost(url) ? false : { rejectUnauthorized: false },
            max: 2,
            connectionTimeoutMillis: 8_000,
            idleTimeoutMillis: 10_000,
        });
        pool.on("error", (err) => console.warn(`[dbPrimary] ${t.id} idle client error:`, err.message));
        pools[t.id] = pool;
    }
    return pool;
}

/** Runs `fn` on `id`'s database. Writes must open their own `BEGIN READ WRITE` — staging is read-only. */
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

/** The row in `id`, or null when the table does not exist yet. Throws if the database is unreachable. */
export async function readSwitchRow(id: DbId): Promise<SwitchRow | null> {
    return withDb(id, async (c) => {
        try {
            const r = await c.query<SwitchRow>(`SELECT * FROM "_db_switch" WHERE only_row`);
            return r.rows[0] ?? null;
        } catch (e) {
            if ((e as { code?: string }).code === "42P01") return null; // table not created yet
            throw e;
        }
    });
}

async function resolve(): Promise<DbId> {
    const answers = await Promise.allSettled([readSwitchRow("DB1"), readSwitchRow("DB2")]);
    let best: { id: DbId; at: number } | null = null;
    let anyAnswered = false;
    for (const a of answers) {
        if (a.status !== "fulfilled") continue;
        anyAnswered = true;
        const row = a.value;
        if (!row || (row.primary_db !== "DB1" && row.primary_db !== "DB2")) continue;
        const at = new Date(row.switched_at).getTime();
        if (!best || at > best.at) best = { id: row.primary_db, at };
    }
    // Nobody answered: keep what we had rather than guess.
    if (!anyAnswered) return cache.primary;
    // Never switched: DB1 is primary — the database this deployment ran on before DB2 existed.
    return best?.id ?? "DB1";
}

/** Re-reads the primary now. Concurrent callers share one round trip. */
export function refreshPrimary(): Promise<DbId> {
    if (!isDualDb()) return Promise.resolve("DB1");
    if (cache.inflight) return cache.inflight;
    cache.inflight = resolve()
        .then((id) => {
            if (id !== cache.primary) console.info(`[dbPrimary] primary is now ${id}`);
            cache.primary = id;
            cache.checkedAt = Date.now();
            return id;
        })
        .catch((e) => {
            console.warn("[dbPrimary] could not read the primary, keeping", cache.primary, e);
            return cache.primary;
        })
        .finally(() => {
            cache.inflight = null;
        });
    return cache.inflight;
}

/**
 * The primary as last read — synchronous, for Prisma's hot path. When the answer is older
 * than `TTL_MS` a refresh starts in the background; this call never waits for it.
 * `instrumentation.ts` awaits the first read, so a fresh server never starts on a guess.
 */
export function currentPrimary(): DbId {
    if (!isDualDb()) return "DB1";
    if (Date.now() - cache.checkedAt > TTL_MS) void refreshPrimary();
    return cache.primary;
}

/** Forget the cached answer — called when a write hit a read-only database (a stale pointer). */
export function invalidatePrimary(): void {
    cache.checkedAt = 0;
    void refreshPrimary();
}

/** Primary and staging targets, freshly read. Staging is null in single-database mode. */
export async function primaryAndStaging(): Promise<{ primary: DbTarget; staging: DbTarget | null }> {
    const id = await refreshPrimary();
    const primary = dbTarget(id);
    if (!primary) throw new Error(`${id} is not configured.`);
    return { primary, staging: isDualDb() ? dbTarget(otherDb(id)) : null };
}
