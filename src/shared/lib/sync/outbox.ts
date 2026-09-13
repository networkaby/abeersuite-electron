/**
 * Reading and retiring the local write queue.
 *
 * Rows are put there by the `_outbox_capture` trigger on every replicated table (see
 * scripts/gen-local-schema.ts), one per committed local write. This module is only the
 * read side plus bookkeeping: what to push next, what succeeded, what to back off or
 * give up on. Applying them to the cloud is `push.ts`.
 *
 * Raw `pg` rather than Prisma, because `_outbox` is not a Prisma model — and because
 * the payload has to be read as text to keep Decimal and BigInt exact.
 */

import { parsePayloadExact } from "./payload";
import { SYNC_REGISTRY } from "./syncRegistry.generated";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

/**
 * Prisma model name -> client delegate accessor, for every model the outbox is
 * allowed to carry. Single source of truth shared by the write interceptor
 * (`prismaClient.ts`, which enqueues) and `/api/sync/push` (which replays) — a
 * model missing from here is a model the outbox pipeline does not know about.
 *
 * Every autoincrement model here is id-range-protected — `_apply_id_range()` finds
 * them all from the catalogue (see `idRange.ts`). TicketRepair/TicketHelp/TicketDeal
 * share their parent Ticket's id (no separate sequence, so no collision risk of
 * their own).
 */
export const OUTBOX_MODEL_DELEGATES: Record<string, string> = {
    UniversalVoucher: "universalVoucher",
    VoucherDetail: "voucherDetail",
    VoucherGlLine: "voucherGlLine",
    VoucherInventoryLine: "voucherInventoryLine",
    VoucherLink: "voucherLink",
    Ticket: "ticket",
    TicketLog: "ticketLog",
    TicketRepair: "ticketRepair",
    TicketHelp: "ticketHelp",
    TicketDeal: "ticketDeal",
    PosShift: "posShift",
    PosCashDrop: "posCashDrop",
};

export interface OutboxRecord {
    id: number;
    table_name: string;
    /** PK values joined by US (0x1f) — for logs. Use `row_key` to address the row. */
    row_pk: string;
    /** `{column: value}` for the row's primary key, compound keys included. */
    row_key: Record<string, unknown>;
    operation: "create" | "update";
    payload: Record<string, unknown>;
    created_at: Date;
    pushed_at: Date | null;
    idempotency_key: string;
    error: string | null;
    attempts: number;
    next_attempt_at: Date | null;
    dead_lettered_at: Date | null;
}

// Nothing enqueues from TypeScript any more. Rows are written by the `_outbox_capture`
// trigger on every replicated table (see scripts/gen-local-schema.ts), which records
// the committed row rather than the arguments that produced it and cannot be bypassed
// by createMany, upsert, a nested write or raw SQL. `idempotency_key` is filled by its
// column default.

/** Give up on a row after this many attempts and let the queue behind it move. */
export const MAX_PUSH_ATTEMPTS = 10;

/**
 * The next batch to push, oldest first.
 *
 * ── ORDER BY id, not created_at ─────────────────────────────────────────────
 * This looks like a cosmetic change and is not. `created_at` defaults to `now()`,
 * which in PostgreSQL is the transaction's START time, so two overlapping
 * transactions can commit in the opposite order from their timestamps. `id` is
 * allocated inside the capture trigger at write time, so it always reflects real
 * commit order — which is what makes replaying in this order satisfy the cloud's
 * foreign keys (see push.ts).
 *
 * `payload` comes back as TEXT so the caller can keep Decimal and BigInt exact;
 * letting the driver JSON.parse it would round them to doubles first.
 */
export async function getPendingOutbox(localUrl: string, limit = 50): Promise<OutboxRecord[]> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const res = await client.query<OutboxRecord & { payload_text: string }>(
            `SELECT id, table_name, row_pk, row_key, operation,
                    payload::text AS payload_text,
                    created_at, pushed_at, idempotency_key, error,
                    attempts, next_attempt_at, dead_lettered_at
             FROM "_outbox"
             WHERE pushed_at IS NULL
               AND dead_lettered_at IS NULL
               AND (next_attempt_at IS NULL OR next_attempt_at <= now())
             ORDER BY id ASC
             LIMIT $1`,
            [limit],
        );
        return res.rows.map((row) => ({
            ...row,
            payload: parsePayloadExact(row.payload_text, SYNC_REGISTRY[row.table_name]?.exact ?? []),
        }));
    } catch (err) {
        console.error("[Outbox] Failed to fetch pending outbox records:", err);
        return [];
    } finally {
        await client.end().catch(() => { });
    }
}

/**
 * Records a failed push: back off, and dead-letter once it is clearly not transient.
 *
 * The dead letter is what makes "stop at the first failure" safe. Without it a single
 * unpushable row — a parent the office deleted, a unique collision — would block every
 * later mutation on the machine indefinitely, and the only symptom would be a pending
 * count that never fell.
 *
 * A permanent failure (unknown table, no such delegate) skips the backoff entirely;
 * retrying it ten times could not change the answer.
 */
export async function markOutboxFailure(
    localUrl: string,
    id: number,
    error: string,
    permanent = false,
): Promise<void> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        await client.query(
            `UPDATE "_outbox"
                SET attempts = attempts + 1,
                    error = $2,
                    next_attempt_at = now() + least(
                        make_interval(secs => 15 * power(2, attempts)::int),
                        interval '15 minutes'
                    ),
                    dead_lettered_at = CASE
                        WHEN $3 OR attempts + 1 >= $4 THEN now()
                        ELSE dead_lettered_at
                    END
              WHERE id = $1`,
            [id, error, permanent, MAX_PUSH_ATTEMPTS],
        );
    } catch (err) {
        console.error("[Outbox] Failed to record push failure:", err);
    } finally {
        await client.end().catch(() => { });
    }
}

/**
 * Dead-letters EVERY unpushed row at once, with one reason. The released-counter
 * rule: once the DB says this device holds no counter, nothing it queued while it
 * believed otherwise may reach the books — a sale billed at 11:00 on a counter released
 * at 10:30 is refused when the PC reconnects at 13:00, not accepted late. Returns how
 * many rows were refused so the caller can say so in the log.
 */
export async function rejectAllPending(localUrl: string, reason: string): Promise<number> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const res = await client.query(
            `UPDATE "_outbox"
                SET dead_lettered_at = now(), error = $1
              WHERE pushed_at IS NULL AND dead_lettered_at IS NULL`,
            [reason],
        );
        return res.rowCount ?? 0;
    } catch (err) {
        console.error("[Outbox] Failed to reject pending rows:", err);
        return 0;
    } finally {
        await client.end().catch(() => { });
    }
}

/**
 * Marks outbox entries as pushed upon successful remote persistence.
 */
export async function markOutboxPushed(localUrl: string, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        await client.query(
            `UPDATE "_outbox"
             SET pushed_at = now(), error = NULL
             WHERE id = ANY($1::int[])`,
            [ids],
        );
    } catch (err) {
        console.error("[Outbox] Failed to mark records as pushed:", err);
    } finally {
        await client.end().catch(() => { });
    }
}

export interface OutboxStatusResult {
    pending: number;
    failed: number;
    retrying: number;
    lastSyncedAt: string | null;
}

/**
 * Counts for the shell badge and `/api/counter/status`.
 *
 * `failed` counts DEAD-LETTERED rows specifically, not merely rows that have errored
 * once. A row that failed on a transient network blip and is waiting to retry is not
 * something a cashier can act on; a dead-lettered one is the only state that needs a
 * human, and nothing surfaced it before.
 */
export async function getOutboxStatus(localUrl: string): Promise<OutboxStatusResult> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const res = await client.query<{ pending: string; failed: string; retrying: string; last_synced_at: Date | null }>(
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
        await client.end().catch(() => { });
    }
}
