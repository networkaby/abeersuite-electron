/**
 * Offline Outbox Storage & Sync Helpers
 *
 * Persists offline mutations to the local PostgreSQL `_outbox` table in the same
 * transaction as the modified record. Once online connectivity is restored, mutations
 * are read in FIFO order (`created_at ASC`) and pushed to the cloud endpoint.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

/**
 * Prisma model name -> client delegate accessor, for every model the outbox is
 * allowed to carry. Single source of truth shared by the write interceptor
 * (`prismaClient.ts`, which enqueues) and `/api/sync/push` (which replays) — a
 * model missing from here is a model the outbox pipeline does not know about.
 *
 * 7 are id-range-protected (`OFFLINE_SEQUENCE_MAP` in `idRange.ts`); PosShift/
 * PosCashDrop/PosExpenditure/PosReceipt are also autoincrement and protected the
 * same way; TicketRepair/TicketHelp/TicketDeal share their parent Ticket's id
 * (no separate sequence, so no collision risk of their own).
 */
export const OUTBOX_MODEL_DELEGATES: Record<string, string> = {
    UniversalVoucher:     "universalVoucher",
    VoucherDetail:        "voucherDetail",
    VoucherGlLine:        "voucherGlLine",
    VoucherInventoryLine: "voucherInventoryLine",
    VoucherLink:          "voucherLink",
    Ticket:               "ticket",
    TicketLog:            "ticketLog",
    TicketRepair:         "ticketRepair",
    TicketHelp:           "ticketHelp",
    TicketDeal:           "ticketDeal",
    PosShift:             "posShift",
    PosCashDrop:          "posCashDrop",
    PosExpenditure:       "posExpenditure",
    PosReceipt:           "posReceipt",
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

/**
 * Retrieves unpushed outbox records in chronological order.
 */
export async function getPendingOutbox(localUrl: string, limit = 50): Promise<OutboxRecord[]> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const res = await client.query<OutboxRecord>(
            `SELECT id, table_name, row_pk, operation, payload, created_at, pushed_at, idempotency_key, error
             FROM "_outbox"
             WHERE pushed_at IS NULL
             ORDER BY created_at ASC
             LIMIT $1`,
            [limit],
        );
        return res.rows;
    } catch (err) {
        console.error("[Outbox] Failed to fetch pending outbox records:", err);
        return [];
    } finally {
        await client.end().catch(() => {});
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
        await client.end().catch(() => {});
    }
}

/**
 * Stamps an error message on a failing outbox record for manual review/retry.
 */
export async function markOutboxError(localUrl: string, id: number, error: string): Promise<void> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        await client.query(
            `UPDATE "_outbox"
             SET error = $1
             WHERE id = $2`,
            [error, id],
        );
    } catch (err) {
        console.error("[Outbox] Failed to record error on outbox record:", err);
    } finally {
        await client.end().catch(() => {});
    }
}

/**
 * Returns summary count of pending and errored outbox items, plus the last
 * time any mutation from this PC was confirmed pushed — the "last synced"
 * answer for the shell badge.
 */
export async function getOutboxStatus(localUrl: string): Promise<{ pending: number; failed: number; lastSyncedAt: string | null }> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const res = await client.query<{ pending: string; failed: string; last_synced_at: Date | null }>(
            `SELECT
                count(*) FILTER (WHERE pushed_at IS NULL) as pending,
                count(*) FILTER (WHERE error IS NOT NULL AND pushed_at IS NULL) as failed,
                max(pushed_at) as last_synced_at
             FROM "_outbox"`,
        );
        const row = res.rows[0];
        return {
            pending: parseInt(row?.pending ?? "0", 10),
            failed: parseInt(row?.failed ?? "0", 10),
            lastSyncedAt: row?.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
        };
    } catch {
        return { pending: 0, failed: 0, lastSyncedAt: null };
    } finally {
        await client.end().catch(() => {});
    }
}
