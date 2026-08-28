import "server-only";
import { getLocalClient } from "./prismaClient";
import { setReplicaReady, readyIsStale, isReplicaReady, IS_COUNTER_PC } from "./counterMode";

/**
 * Asks the counter's replica whether it considers itself trustworthy.
 *
 * The sync worker writes `_sync_status` (a single row) after every cycle: schema in
 * step with the source, and every table synced at least once. The app reads that
 * rather than assuming, because the failure it guards against is silent — a
 * partially seeded replica does not error, it returns FEWER ROWS, so a report
 * renders successfully with records missing. To a user that reads as "those records
 * do not exist", not "this database is not ready yet".
 *
 * `_sync_status` is the worker's own bookkeeping and deliberately not a Prisma
 * model, so it is read with `$queryRaw`. That is a read, which the replica client
 * permits — it is not a way around the write guard.
 *
 * Fails CLOSED. Any error — the worker has never run so the table is absent, no
 * permission, connection refused — leaves the replica not-ready and reads keep going
 * to Supabase. Slow and correct beats fast and wrong.
 */
export async function refreshReplicaReadiness(): Promise<boolean> {
    if (!IS_COUNTER_PC) return false;

    const local = getLocalClient();
    if (!local) return false;

    // Cheap enough to call from a request path only because of this: one query per
    // TTL, not one per request. Return the CACHED answer while it is fresh — returning
    // false here conflated "asked recently" with "not ready", so a caller that happened
    // to arrive inside the TTL was told the replica was unusable when it was fine.
    if (!readyIsStale()) return isReplicaReady();

    try {
        const rows = await local.$queryRaw<{ ready: boolean }[]>`
            SELECT ready FROM "_sync_status" WHERE only_row
        `;
        const ready = rows.length > 0 && rows[0].ready === true;
        setReplicaReady(ready);
        return ready;
    } catch {
        setReplicaReady(false);
        return false;
    }
}
