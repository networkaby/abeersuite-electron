/**
 * Outbox status helper for counter write-queue synchronization.
 *
 * Used by /api/sync/status to report pending, retrying, and dead-lettered writes
 * from the local PostgreSQL replica's `_outbox` table.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

export interface OutboxStatusResult {
    pending: number;
    failed: number;
    retrying: number;
    lastSyncedAt: string | null;
}

/**
 * Counts for the shell badge and /api/sync/status.
 *
 * Returns zeroed counts if the table does not exist or connection cannot be established.
 */
export async function getOutboxStatus(localUrl: string): Promise<OutboxStatusResult> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const res = await client.query<{
            pending: string;
            failed: string;
            retrying: string;
            last_synced_at: Date | null;
        }>(
            `SELECT
                count(*) FILTER (WHERE pushed_at IS NULL AND dead_lettered_at IS NULL) AS pending,
                count(*) FILTER (WHERE dead_lettered_at IS NOT NULL AND pushed_at IS NULL) AS failed,
                count(*) FILTER (WHERE pushed_at IS NULL AND dead_lettered_at IS NULL AND attempts > 0) AS retrying,
                max(pushed_at) AS last_synced_at
             FROM "_outbox"`,
        );
        const row = res.rows[0];
        return {
            pending: parseInt(row?.pending ?? "0", 10),
            failed: parseInt(row?.failed ?? "0", 10),
            retrying: parseInt(row?.retrying ?? "0", 10),
            lastSyncedAt: row?.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
        };
    } catch {
        return { pending: 0, failed: 0, retrying: 0, lastSyncedAt: null };
    } finally {
        await client.end().catch(() => {});
    }
}
