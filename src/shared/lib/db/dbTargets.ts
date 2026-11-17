/**
 * The two Supabase databases, DB1 and DB2, as `.env` names them.
 *
 * Either can be PRIMARY (everyone works on it) or STAGING (the spare, copied from the
 * primary every night and kept read-only). Which one is primary is not in `.env` — it is
 * a row in both databases (`dbPrimary.ts`), so a switch takes effect without a redeploy.
 *
 *   DATABASE_URL_1 / DIRECT_URL_1   — DB1. Fall back to DATABASE_URL / DIRECT_URL, which
 *                                      counters and local dev still use.
 *   DATABASE_URL_2 / DIRECT_URL_2   — DB2. Absent = single-database mode: no switch, no
 *                                      nightly copy, and nothing below costs a thing.
 *
 * Pure (no Prisma, no Next) so scripts can read it too.
 */

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
    const keys = dbEnvKeys(id);
    const pooled = clean(process.env[keys.pooled]) ?? (id === "DB1" ? clean(process.env.DATABASE_URL) : undefined);
    if (!pooled) return null;
    const direct =
        clean(process.env[keys.direct]) ?? (id === "DB1" ? clean(process.env.DIRECT_URL) : undefined) ?? pooled;
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

export function isDbId(v: unknown): v is DbId {
    return v === "DB1" || v === "DB2";
}
