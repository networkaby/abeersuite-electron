/**
 * Resolves the direct (session-mode) Postgres connection string used by
 * `pg_dump` / `pg_restore`. The pooled URL in `DATABASE_URL` (pgbouncer on
 * port 6543) does not work with those binaries.
 *
 * Prefers `DIRECT_DATABASE_URL`; falls back to swapping `:6543` → `:5432` on
 * `DATABASE_URL` AND stripping pooler-only query params (`pgbouncer`,
 * `connection_limit`, `pool_timeout`) which `pg_dump` rejects as invalid URI
 * parameters.
 */
export function getDirectDatabaseUrl(): string {
    const direct = process.env.DIRECT_DATABASE_URL;
    if (direct && direct.trim()) return stripPoolerParams(direct.trim());

    const pooled = process.env.DATABASE_URL;
    if (pooled) {
        const swapped = pooled.includes(":6543") ? pooled.replace(":6543", ":5432") : pooled;
        return stripPoolerParams(swapped);
    }

    throw new Error(
        "DIRECT_DATABASE_URL is not set. Add it to .env using Supabase → Settings → Database → Direct connection (port 5432).",
    );
}

const POOLER_ONLY_PARAMS = ["pgbouncer", "connection_limit", "pool_timeout", "statement_cache_size"];

function stripPoolerParams(url: string): string {
    try {
        const u = new URL(url);
        for (const key of POOLER_ONLY_PARAMS) u.searchParams.delete(key);
        return u.toString();
    } catch {
        // Fall back: leave it alone if URL parsing fails (unusual driver-specific format).
        return url;
    }
}
