/**
 * Background Outbox Flusher
 *
 * Supervised by Electron main process. Periodically inspects the local replica's
 * `_outbox` table for unsynced offline mutations and flushes them to the cloud
 * when connectivity is active.
 */

import { getPendingOutbox, markOutboxPushed, markOutboxError, type OutboxRecord } from "../src/shared/lib/sync/outbox";

let flusherInterval: NodeJS.Timeout | null = null;
let isFlushing = false;

const FLUSH_INTERVAL_MS = 15_000;
const SERVER_PORT = 786;

/**
 * Executes a single flush pass.
 */
export async function flushPendingOutbox(localUrl: string): Promise<number> {
    if (isFlushing) return 0;
    isFlushing = true;

    try {
        const pending = await getPendingOutbox(localUrl, 50);
        if (pending.length === 0) return 0;

        console.log(`[OutboxFlusher] Found ${pending.length} pending offline mutations. Flushing...`);

        const pushPayload = {
            mutations: pending.map((p: OutboxRecord) => ({
                id:             p.id,
                tableName:      p.table_name,
                rowPk:          p.row_pk,
                operation:      p.operation,
                payload:        p.payload,
                idempotencyKey: p.idempotency_key,
            })),
        };

        const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/sync/push`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(pushPayload),
        });

        if (!res.ok) {
            console.warn(`[OutboxFlusher] Push endpoint returned status ${res.status}`);
            return 0;
        }

        const data = await res.json() as {
            successfulIds: number[];
            failed: Array<{ id: number; error: string }>;
        };

        if (data.successfulIds && data.successfulIds.length > 0) {
            await markOutboxPushed(localUrl, data.successfulIds);
            console.log(`[OutboxFlusher] Successfully pushed ${data.successfulIds.length} mutations.`);
        }

        if (data.failed && data.failed.length > 0) {
            for (const f of data.failed) {
                await markOutboxError(localUrl, f.id, f.error);
                console.warn(`[OutboxFlusher] Mutation ${f.id} rejected: ${f.error}`);
            }
        }

        return data.successfulIds?.length ?? 0;
    } catch (err) {
        // Normal during offline periods or before server warms up
        return 0;
    } finally {
        isFlushing = false;
    }
}

/**
 * Starts periodic outbox flushing.
 */
export function startOutboxFlusher(localUrl: string): void {
    if (flusherInterval) return;

    console.log("[OutboxFlusher] Starting background outbox flusher...");
    flusherInterval = setInterval(() => {
        flushPendingOutbox(localUrl).catch(() => {});
    }, FLUSH_INTERVAL_MS);
}

/**
 * Stops background outbox flushing on app exit.
 */
export function stopOutboxFlusher(): void {
    if (flusherInterval) {
        clearInterval(flusherInterval);
        flusherInterval = null;
        console.log("[OutboxFlusher] Stopped background outbox flusher.");
    }
}
