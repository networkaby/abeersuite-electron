/**
 * Empties the replica of a PC that holds no counter.
 *
 * Rule (owner): a PC without a counter carries no business data. The sync worker already
 * refuses to fill a replica on a machine with no `counter-setup.json`; this is the other
 * half — a machine whose counter was released, or whose onboarding never finished, must
 * not keep the dataset it pulled while it was one.
 *
 * ── Immediate, and the outbox does not matter ───────────────────────────────
 * This used to wait for `_outbox` to drain first. Owner decision: a PC that is not a
 * counter has nothing meaningful to push — whatever it holds was written against a
 * counter it no longer is — so the wipe runs at once and `_outbox` goes with the rest.
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

export type WipeOutcome = "wiped" | "nothing-to-wipe" | "error";

/** Has the worker ever filled this replica? Cheap "is there anything here" test. */
async function hasSyncedData(client: InstanceType<typeof PgClient>): Promise<boolean> {
    const res = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM "_sync_state"`,
    ).catch(() => ({ rows: [{ n: "0" }] }));
    return parseInt(res.rows[0]?.n ?? "0", 10) > 0;
}

/**
 * Empties the replica now. Never throws. No-op on a replica the worker never filled, so
 * calling it on every no-counter boot costs one count query on a fresh install.
 */
export async function wipeReplica(adminUrl: string): Promise<WipeOutcome> {
    const client = new PgClient({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });
    try {
        await client.connect();
        if (!(await hasSyncedData(client))) return "nothing-to-wipe";

        const { rows } = await client.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.tables
              WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
        );
        const tables = rows.map((r) => r.table_name).filter((t) => !KEEP.has(t));
        if (tables.length === 0) return "nothing-to-wipe";

        // One statement, one transaction: either the whole replica is empty or none of it
        // is. RESTART IDENTITY puts the sequences back to 1 — the next onboarding
        // re-applies this PC's id block through _apply_id_range().
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
 * Does the replica still say the counter in `counter-setup.json` is bound to this PC?
 *
 * Asked at boot on a PC that holds a file, after the splash wait — so when the machine
 * is online the worker has just pulled `pos_counters` and the row IS the DB's answer; when
 * it is offline the row is the last one the DB gave it. Either way no cloud call.
 *
 * Returns null when the question cannot be answered (replica unreadable), which the
 * caller must treat as "keep the file", never as "released".
 */
export async function replicaBindsThisPc(
    adminUrl: string,
    counterId: number,
    deviceIds: string[],
): Promise<boolean | null> {
    if (deviceIds.length === 0) return null;
    const client = new PgClient({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });
    try {
        await client.connect();
        const res = await client.query<{ n: string }>(
            `SELECT count(*) AS n FROM "pos_counters"
              WHERE id = $1 AND "boundDeviceId" = ANY($2::text[])`,
            [counterId, deviceIds],
        );
        return parseInt(res.rows[0]?.n ?? "0", 10) > 0;
    } catch (err) {
        console.error("[ReplicaWipe] Could not read this PC's binding from the replica:", err);
        return null;
    } finally {
        await client.end().catch(() => {});
    }
}
