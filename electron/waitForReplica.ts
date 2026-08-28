/**
 * Waits for the replica's first sync before the app is allowed to serve pages.
 *
 * ── Why this has to exist ───────────────────────────────────────────────────
 * A freshly provisioned replica has 113 empty tables. Reading from it does not fail;
 * it returns FEWER ROWS. A product list renders with nothing in it, a ledger renders
 * with no entries — which reads as "these records were deleted", not "this database
 * has not finished filling". That is the worst failure mode for a database the counter
 * is trusting, and it is silent by construction.
 *
 * The sync worker publishes `_sync_status.ready` once the schema matches and every
 * table has synced at least once. This waits for that, showing real progress from
 * `tables_synced` / `tables_total`, which the worker already writes each cycle.
 *
 * ── Why it does not block forever ───────────────────────────────────────────
 * A counter that is offline on its very first launch would otherwise never start. On
 * timeout we proceed: the app's own readiness gate fails closed independently (see
 * counterMode.ts), so reads keep going to the live database and the in-app overlay
 * covers anything that must not run against a half-filled replica. Waiting here is
 * for a good first-run experience, not for correctness.
 *
 * On an already-provisioned machine — every launch after the first — `ready` is
 * already true and this returns on the first poll.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

export type ReplicaWaitResult = "ready" | "timeout" | "error";

interface SyncStatusRow {
    ready: boolean;
    ready_detail: string | null;
    schema_ok: boolean;
    schema_detail: string | null;
    tables_total: number | null;
    tables_synced: number | null;
}

const POLL_INTERVAL_MS = 2_000;

/**
 * @param adminUrl    Connection string for the embedded cluster.
 * @param onProgress  Called with a human-readable line each time the picture changes.
 * @param timeoutMs   How long to wait for the FIRST sync before giving up.
 */
export async function waitForReplicaReady(
    adminUrl: string,
    onProgress: (message: string) => void,
    timeoutMs = 5 * 60_000,
): Promise<ReplicaWaitResult> {
    const deadline = Date.now() + timeoutMs;
    let lastMessage = "";

    const say = (message: string) => {
        if (message === lastMessage) return;
        lastMessage = message;
        onProgress(message);
    };

    while (Date.now() < deadline) {
        let row: SyncStatusRow | null = null;
        const client = new PgClient({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });
        try {
            await client.connect();
            const res = await client.query<SyncStatusRow>(
                `SELECT ready, ready_detail, schema_ok, schema_detail, tables_total, tables_synced
                   FROM "_sync_status" WHERE only_row`,
            );
            row = res.rows[0] ?? null;
        } catch {
            // The worker creates _sync_status on its first cycle, so "table does not
            // exist" simply means it has not got there yet. Keep waiting.
            row = null;
        } finally {
            await client.end().catch(() => {});
        }

        if (row?.ready) {
            say("Counter data is up to date.");
            return "ready";
        }

        // Schema drift is the one failure waiting cannot resolve — only a deploy can.
        // Say so and let the app start rather than sitting on a splash for five minutes.
        if (row && row.schema_ok === false) {
            console.error("[Replica] schema drift:", row.schema_detail);
            say("Counter database is out of step with this app version — using the live server.");
            return "error";
        }

        if (row?.tables_total) {
            say(`Preparing this counter — first sync (${row.tables_synced ?? 0} of ${row.tables_total} tables)…`);
        } else {
            say("Preparing this counter — first sync…");
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    console.warn("[Replica] first sync did not complete within the boot window.");
    say("Counter data is still catching up — using the live server for now.");
    return "timeout";
}
