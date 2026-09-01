/**
 * The inbound half of sync status — "is this replica actually keeping up?"
 *
 * `_outbox` answers the outbound question (did MY writes leave this machine).
 * Nothing answered the inbound one: the pull engine's only visible output was the
 * boot splash and the blocking gate, so a replica that had quietly stopped
 * receiving looked identical to a healthy one.
 *
 * ── What can honestly be known here, and what cannot ─────────────────────────
 * NOT "the server has rows we have not pulled". Nothing local can know that
 * without asking Supabase, which is the egress this whole design exists to avoid.
 * Worse, `_sync_state.last_ok_at` looks like it answers that and does not:
 * `recordSuccess` stamps it on every successful pull whether or not a single row
 * changed (sync-engine/lib/state.js), so it means "last time we CHECKED this
 * table". A stale one says the worker is not running; a fresh one says nothing
 * at all about whether the source moved.
 *
 * So this module reports only what the replica genuinely knows about itself:
 *
 *   • tables that have NEVER synced   — `last_ok_at IS NULL`, and the reason
 *                                       `_sync_status.ready` is false. A report
 *                                       over these renders fine and silently
 *                                       omits rows, which is the failure mode
 *                                       worth surfacing above all others.
 *   • tables currently FAILING        — `last_error` set by `recordFailure`.
 *   • when the worker last finished   — `_sync_status.last_cycle_at`. Old means
 *                                       the worker is stopped or wedged; it does
 *                                       NOT mean we are behind, and the label
 *                                       must not claim otherwise.
 *
 * The transient "a change was announced and the worker has not applied it yet"
 * state — the one a person actually watches for after someone else saves — is
 * knowable only in the BROWSER, by pairing the `app:changes` signal with the
 * worker's `__SYNC_APPLIED__`. It lives in `useSyncStatus`, not here.
 *
 * Raw `pg` rather than Prisma, like `outbox.ts`: these are engine-owned tables
 * outside the Prisma schema. The app's role is granted SELECT on both by
 * `sync-engine/lib/status.js`.
 */

import { Client as PgClient } from "pg";

export interface ReplicaLagResult {
    /** Models never pulled even once — the replica is incomplete for these. */
    neverSynced: string[];
    /** Models whose last pull attempt errored. */
    failing: string[];
    /** When the worker last completed a cycle, or null if it never has. */
    lastCycleAt: string | null;
    /** The engine's own verdict: may this replica serve reads at all? */
    ready: boolean;
    tablesSynced: number;
    tablesTotal: number;
}

/** Enough names to say something useful without turning a badge into a list. */
const MAX_NAMES = 12;

const EMPTY: ReplicaLagResult = {
    neverSynced: [], failing: [], lastCycleAt: null,
    ready: true, tablesSynced: 0, tablesTotal: 0,
};

/**
 * Read the replica's own account of itself.
 *
 * Returns `EMPTY` (which reads as "nothing wrong") on any failure, including the
 * tables not existing yet on a replica mid-first-sync. A status widget that throws
 * is worse than one that says nothing — the caller is a 10s poll behind a badge,
 * not a correctness path.
 */
export async function getReplicaLag(localUrl: string): Promise<ReplicaLagResult> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();

        // "Never synced" is `last_ok_at IS NULL`, NOT `watermark IS NULL`. A `full`
        // strategy table has no watermark by definition — recordSuccess is called
        // with null for it every cycle — so testing the watermark would report every
        // full table as permanently unsynced. `last_ok_at` is the test the engine
        // itself uses to count synced tables (sync-engine/sync-once.js).
        const state = await client.query<{ model: string; last_ok_at: Date | null; last_error: string | null }>(
            `SELECT model, last_ok_at, last_error FROM "_sync_state" ORDER BY model`,
        );
        const status = await client.query<{
            ready: boolean; last_cycle_at: Date | null;
            tables_total: number | null; tables_synced: number | null;
        }>(`SELECT ready, last_cycle_at, tables_total, tables_synced FROM "_sync_status" WHERE only_row`);

        const row = status.rows[0];
        return {
            neverSynced: state.rows.filter((r) => r.last_ok_at === null).map((r) => r.model).slice(0, MAX_NAMES),
            failing: state.rows.filter((r) => r.last_error).map((r) => r.model).slice(0, MAX_NAMES),
            lastCycleAt: row?.last_cycle_at ? new Date(row.last_cycle_at).toISOString() : null,
            ready: row?.ready ?? true,
            tablesSynced: row?.tables_synced ?? 0,
            tablesTotal: row?.tables_total ?? 0,
        };
    } catch {
        return EMPTY;
    } finally {
        await client.end().catch(() => { });
    }
}
