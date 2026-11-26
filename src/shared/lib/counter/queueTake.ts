/**
 * Which app push / email rows the office's communications cron may take and send
 * (counterQueue.ts, notifyEmail.ts `sendQueuedEmails`). Pure, so it is tested.
 *
 * - "queued": a counter left it for the office.
 * - "pending" and untouched for STUCK_AFTER_MS: a send that started (a cron run, or
 *   the office's own send) and stopped before writing its outcome — a time limit,
 *   a crash, a deploy. Sent again; if the first one had in fact gone, the customer
 *   gets a second push / email, which is harmless. WhatsApp is never retried here.
 *
 * Only kinds the office can rebuild from the document are retried when stuck.
 */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

/** Rows worth taking, for the findMany. `field` is the status column. */
export function takeableWhere<F extends string>(field: F, stuckBefore: Date, rebuildableKinds: readonly string[]) {
    return {
        OR: [
            { [field]: "queued" },
            { [field]: "pending", updatedAt: { lt: stuckBefore }, kind: { in: [...rebuildableKinds] } },
        ],
    } as { OR: Array<Record<string, unknown>> };
}

/** The guarded update's `where` for one row: still as it was read, so two runs never both take it. */
export function takeRowWhere<F extends string>(field: F, id: number, status: string, stuckBefore: Date) {
    return status === "pending"
        ? { id, [field]: "pending", updatedAt: { lt: stuckBefore } }
        : { id, [field]: "queued" };
}

