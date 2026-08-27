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
    row_pk: string;
    operation: "create" | "update";
    payload: Record<string, unknown>;
    created_at: Date;
    pushed_at: Date | null;
    idempotency_key: string;
    error: string | null;
}

export interface EnqueueOutboxParams {
    tableName: string;
    rowPk: string;
    operation: "create" | "update";
    payload: Record<string, unknown>;
    idempotencyKey?: string;
}

/**
 * Generates a stable idempotency key if one is not provided.
 */
export function generateIdempotencyKey(tableName: string, rowPk: string, operation: string): string {
    return `${tableName}:${rowPk}:${operation}:${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Enqueues an offline mutation into `_outbox` using a raw SQL client or transaction client.
 */
export async function enqueueOutbox(
    client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    params: EnqueueOutboxParams,
): Promise<void> {
    const { tableName, rowPk, operation, payload } = params;
    const idempotencyKey = params.idempotencyKey || generateIdempotencyKey(tableName, rowPk, operation);

    await client.query(
        `INSERT INTO "_outbox" (table_name, row_pk, operation, payload, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [tableName, rowPk, operation, JSON.stringify(payload), idempotencyKey],
    );
}

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
 * Returns summary count of pending and errored outbox items.
 */
export async function getOutboxStatus(localUrl: string): Promise<{ pending: number; failed: number }> {
    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const res = await client.query<{ pending: string; failed: string }>(
            `SELECT
                count(*) FILTER (WHERE pushed_at IS NULL) as pending,
                count(*) FILTER (WHERE error IS NOT NULL AND pushed_at IS NULL) as failed
             FROM "_outbox"`,
        );
        return {
            pending: parseInt(res.rows[0]?.pending ?? "0", 10),
            failed: parseInt(res.rows[0]?.failed ?? "0", 10),
        };
    } catch {
        return { pending: 0, failed: 0 };
    } finally {
        await client.end().catch(() => {});
    }
}
