/**
 * Applies the reserved id range to the local embedded PostgreSQL sequences.
 *
 * Called after the shift-open API returns an `idRangeStart` value. Each of the 7
 * autoincrement sequences is restarted at `blockStart`, so that any rows created
 * offline get ids in this counter's reserved block and can never collide with
 * cloud-assigned ids or ids from another counter.
 *
 * Idempotent: a bookkeeping table (`_id_ranges`) records the last applied
 * `blockStart`; subsequent calls with the same value are no-ops.
 *
 * Never throws — returns `false` on any failure, same contract as
 * `localDbProvisioner.ts`.
 */

import { OFFLINE_SEQUENCES } from "../src/shared/lib/counter/idRange";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

/**
 * Bookkeeping table: remembers the last applied blockStart so we skip
 * redundant ALTERs on subsequent calls within the same shift.
 */
const ID_RANGES_DDL = `
CREATE TABLE IF NOT EXISTS "_id_ranges" (
    only_row    boolean PRIMARY KEY DEFAULT true CHECK (only_row),
    block_start integer NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
);
`;

/**
 * Applies the reserved id range to the local replica's sequences.
 *
 * @param localUrl    Admin connection string for the embedded cluster
 *                    (e.g. `postgresql://postgres@localhost:54329/smx`).
 * @param blockStart  The first id in this counter's reserved block, as returned
 *                    by `blockStartFor(counterNumber)`.
 * @returns `true` on success, `false` on any failure.
 */
export async function applyIdRanges(localUrl: string, blockStart: number): Promise<boolean> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 10_000 });
    try {
        await client.connect();

        // ── Ensure bookkeeping table exists ──────────────────────────────────
        await client.query(ID_RANGES_DDL);

        // ── Check if already applied ─────────────────────────────────────────
        const { rows } = await client.query<{ block_start: number }>(
            `SELECT block_start FROM "_id_ranges" WHERE only_row`,
        );
        const applied = rows[0]?.block_start;

        if (applied === blockStart) {
            console.log(`[IdRanges] Sequences already set to blockStart ${blockStart} — skipping.`);
            return true;
        }

        if (applied !== undefined) {
            console.log(
                `[IdRanges] blockStart changed from ${applied} to ${blockStart} — re-applying.`,
            );
        } else {
            console.log(`[IdRanges] First application — setting sequences to blockStart ${blockStart}.`);
        }

        // ── ALTER each sequence ──────────────────────────────────────────────
        for (const seq of OFFLINE_SEQUENCES) {
            // Sequence names come from our own constant, not user input — safe to
            // interpolate. PostgreSQL does not accept bind parameters in ALTER SEQUENCE.
            const sql = `ALTER SEQUENCE "${seq}" RESTART WITH ${blockStart}`;
            await client.query(sql);
            console.log(`[IdRanges] ${sql}`);
        }

        // ── Record what we applied ───────────────────────────────────────────
        await client.query(
            `INSERT INTO "_id_ranges" (only_row, block_start) VALUES (true, $1)
             ON CONFLICT (only_row) DO UPDATE SET block_start = EXCLUDED.block_start, applied_at = now()`,
            [blockStart],
        );

        console.log(`[IdRanges] All ${OFFLINE_SEQUENCES.length} sequences set to blockStart ${blockStart}.`);
        return true;
    } catch (err) {
        console.error("[IdRanges] Failed to apply id ranges:", err);
        return false;
    } finally {
        await client.end().catch(() => {});
    }
}
