/**
 * The two Supabase databases, DB1 and DB2, as `.env` names them.
 *
 * Either can be PRIMARY (everyone works on it) or STAGING (the spare, copied from the
 * primary every night and kept read-only). Which one is primary is not in `.env` — it is
 * a row in both databases (`dbPrimary.ts`), so a switch takes effect without a redeploy.
 *
 *   DATABASE_URL_1 / DIRECT_URL_1   — DB1.
 *   DATABASE_URL_2 / DIRECT_URL_2   — DB2. Absent = single-database mode: no switch, no
 *                                      nightly copy, and nothing below costs a thing.
 *
 * No fallback to the old DATABASE_URL / DIRECT_URL on the office (owner, 2026-11-17: "next
 * deploy directly read new env, old gone"). The DESKTOP APP is the one exception: it is
 * handed the primary's pooled URL as DATABASE_URL by `/api/counter/config`, exactly as
 * before (owner: "no changes in counter"), so there DB1 = DATABASE_URL and DB2 is absent.
 * See `usesOfficeHandedDb()` for why that is not the same test as "is a counter".
 *
 * Pure (no Prisma, no Next) so scripts can read it too.
 */

import { usesOfficeHandedDb } from "@/shared/lib/appModeCore";

export type DbId = "DB1" | "DB2";

export const DB_IDS: readonly DbId[] = ["DB1", "DB2"];

export interface DbTarget {
    id: DbId;
    /** Pooled URL (pgbouncer, 6543) — what Prisma and the counters use. */
    pooled: string;
    /** Direct / session URL (5432) — pg_dump, pg_restore, switch. Falls back to pooled. */
    direct: string;
}

const clean = (v: string | undefined) => v?.trim() || undefined;

/** The `.env` names for one database: DB1 → DATABASE_URL_1 / DIRECT_URL_1. */
export function dbEnvKeys(id: DbId): { pooled: string; direct: string } {
    const n = id.slice(2);
    return { pooled: `DATABASE_URL_${n}`, direct: `DIRECT_URL_${n}` };
}

function read(id: DbId): DbTarget | null {
    if (usesOfficeHandedDb()) {
        // Desktop app: the one URL the office handed over — always the primary's.
        // Replica or not: a till whose local database failed still needs it.
        const pooled = id === "DB1" ? clean(process.env.DATABASE_URL) : undefined;
        return pooled ? { id, pooled, direct: pooled } : null;
    }
    const keys = dbEnvKeys(id);
    const pooled = clean(process.env[keys.pooled]);
    if (!pooled) return null;
    const direct = clean(process.env[keys.direct]) ?? pooled;
    return { id, pooled, direct };
}

/** Every configured database, DB1 first. Empty only when no URL is set at all. */
export function dbTargets(): DbTarget[] {
    return DB_IDS.map(read).filter((t): t is DbTarget => t !== null);
}

export function dbTarget(id: DbId): DbTarget | null {
    return read(id);
}

/** True when both DB1 and DB2 are set — the only case where switching exists. */
export function isDualDb(): boolean {
    return dbTargets().length === 2;
}

export function otherDb(id: DbId): DbId {
    return id === "DB1" ? "DB2" : "DB1";
}

/**
 * The primary as `.env` names it: NEXT_PUBLIC_DB_PRIMARY = DB2 (and DB2 set) → DB2, else DB1.
 * The one rule — `currentPrimary()`, `scripts/migrate-primary.mjs` and `prisma.config.ts`
 * all agree with it.
 */
export function namedPrimary(): DbId {
    const named = process.env.NEXT_PUBLIC_DB_PRIMARY?.trim().toUpperCase();
    const k = dbEnvKeys("DB2");
    return named === "DB2" && (clean(process.env[k.pooled]) || clean(process.env[k.direct])) ? "DB2" : "DB1";
}

/**
 * Scripts and seeds: the PRIMARY's direct URL, `sslmode` stripped (they set ssl themselves).
 * Until 2026-11-23 they all read DIRECT_URL_1, so with DB2 primary they checked — or
 * wrote to — the wrong database. Prints which one, so a run always says where it went.
 */
export function scriptDbUrl(): string {
    const id = namedPrimary();
    const k = dbEnvKeys(id);
    const url = (clean(process.env[k.direct]) ?? clean(process.env[k.pooled]) ?? "").replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
    if (url) console.log(`[db] using ${id} (primary)`);
    return url;
}

export function isDbId(v: unknown): v is DbId {
    return v === "DB1" || v === "DB2";
}
