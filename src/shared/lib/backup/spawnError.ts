/**
 * Turns a child_process `spawn` failure into a human-readable message for the
 * backup/restore routes. The common case is `ENOENT` — the Postgres client
 * binary (`pg_dump` / `pg_restore`) is not installed or not on the server's
 * PATH — which otherwise surfaces as an opaque HTTP 500.
 */
export function describeSpawnError(err: unknown, binary: string): string {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
        return `${binary} not found on the server. Install the PostgreSQL client tools (e.g. "postgresql-client") and ensure ${binary} is on the PATH.`;
    }
    const message = err instanceof Error ? err.message : String(err);
    return `Failed to run ${binary}: ${message}`;
}
