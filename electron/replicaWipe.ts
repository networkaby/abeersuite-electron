/**
 * Empties the replica of a PC that no longer holds a counter.
 *
 * Rule: a PC without a counter carries no business data. The sync worker already
 * refuses to fill a replica on a machine with no `counter-setup.json`; this is the other
 * half — a machine whose counter was released (or moved to another PC) must not keep the
 * dataset it pulled while it was one.
 *
 * ── Drain before wipe ────────────────────────────────────────────────────────
 * A counter released while offline may still hold sales in `_outbox` that never reached
 * the cloud. Those leave the machine through the in-process flusher (src/shared/lib/sync/
 * flusher.ts), which keeps running after the setup file is gone. So the wipe waits: while
 * a pending row exists it retries on a timer and destroys nothing. If the push never
 * succeeds the data stays on disk and the app keeps saying so, rather than losing a sale
 * to tidy up a disk.
 *
 * ── TRUNCATE, not DROP DATABASE ──────────────────────────────────────────────
 * Recreating the database needs the source collation, which is only known online
 * (postgresManager.ts). Truncating every table keeps the schema, roles and grants intact
 * and empties `_sync_state` / `_sync_status` too, so the worker's next run sees a never-
 * synced replica and pulls everything, and the app's readiness gate fails closed until
 * then. `_provision` is kept: the schema really is applied, and a re-apply buys nothing.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

/** Tables that describe the replica itself rather than hold data pulled into it. */
const KEEP = new Set(["_provision"]);

const RETRY_MS = 20_000;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export type WipeOutcome = "wiped" | "nothing-to-wipe" | "pending-outbox" | "error";

/** Rows still waiting to be pushed. The table is absent on a never-provisioned replica. */
async function pendingOutbox(client: InstanceType<typeof PgClient>): Promise<number> {
    const res = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM "_outbox"
          WHERE pushed_at IS NULL AND dead_lettered_at IS NULL`,
    ).catch(() => ({ rows: [{ n: "0" }] }));
    return parseInt(res.rows[0]?.n ?? "0", 10);
}

/** Has the worker ever filled this replica? Cheap "is there anything here" test. */
async function hasSyncedData(client: InstanceType<typeof PgClient>): Promise<boolean> {
    const res = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM "_sync_state"`,
    ).catch(() => ({ rows: [{ n: "0" }] }));
    return parseInt(res.rows[0]?.n ?? "0", 10) > 0;
}

/**
 * One attempt. Never throws.
 */
export async function wipeReplicaOnce(adminUrl: string): Promise<WipeOutcome> {
    const client = new PgClient({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });
    try {
        await client.connect();

        const pending = await pendingOutbox(client);
        if (pending > 0) {
            console.log(`[ReplicaWipe] ${pending} outbox row(s) still pending — not wiping yet.`);
            return "pending-outbox";
        }
        if (!(await hasSyncedData(client))) return "nothing-to-wipe";

        const { rows } = await client.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.tables
              WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
        );
        const tables = rows.map((r) => r.table_name).filter((t) => !KEEP.has(t));
        if (tables.length === 0) return "nothing-to-wipe";

        // One statement, one transaction: either the whole replica is empty or none of it
        // is. RESTART IDENTITY puts the sequences back to 1 — the next claim re-applies
        // this PC's id block through _apply_id_range().
        const list = tables.map((t) => `"${t.replace(/"/g, '""')}"`).join(", ");
        await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
        console.log(`[ReplicaWipe] Replica emptied (${tables.length} tables). This PC holds no counter data.`);
        return "wiped";
    } catch (err) {
        console.error("[ReplicaWipe] Could not wipe the replica:", err);
        return "error";
    } finally {
        await client.end().catch(() => {});
    }
}

/**
 * Wipes as soon as the outbox is empty, retrying until it is. Idempotent: a second call
 * while one is scheduled does nothing.
 */
export function requestReplicaWipe(adminUrl: string): void {
    if (timer || inFlight) return;

    const attempt = async () => {
        inFlight = true;
        const outcome = await wipeReplicaOnce(adminUrl);
        inFlight = false;
        if (outcome === "pending-outbox" || outcome === "error") {
            timer = setTimeout(() => { timer = null; void attempt(); }, RETRY_MS);
        }
    };
    void attempt();
}

/** Stops a scheduled retry — called when this PC claims a counter again. */
export function cancelReplicaWipe(): void {
    if (timer) clearTimeout(timer);
    timer = null;
}
