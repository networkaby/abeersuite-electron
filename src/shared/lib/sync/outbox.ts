import type { OutboxMutation } from "./types";
import { broadcastTableMutation } from "./realtimeSync";

const outboxQueue: OutboxMutation[] = [];
let isFlushing = false;

/**
 * Enqueues a local mutation to the outbox queue when the cloud database is unreachable.
 */
export function enqueueOutboxMutation(
    tableNumber: number,
    tableName: string,
    action: "INSERT" | "UPDATE" | "DELETE",
    payload: Record<string, unknown>
): OutboxMutation {
    const entry: OutboxMutation = {
        id: `OUTBOX-${typeof window !== "undefined" ? window.crypto.randomUUID() : Date.now().toString()}`,
        tableNumber,
        tableName,
        action,
        payload,
        createdAt: new Date().toISOString(),
        retries: 0,
    };

    outboxQueue.push(entry);
    return entry;
}

/**
 * Returns current pending outbox mutations count.
 */
export function getPendingOutboxCount(): number {
    return outboxQueue.length;
}

/**
 * Flushes pending outbox mutations to Supabase and broadcasts table mutation events.
 */
export async function flushOutboxQueue(): Promise<{ processed: number; remaining: number }> {
    if (isFlushing || outboxQueue.length === 0) {
        return { processed: 0, remaining: outboxQueue.length };
    }

    isFlushing = true;
    let processed = 0;

    try {
        while (outboxQueue.length > 0) {
            const entry = outboxQueue[0];
            try {
                // Once applied to cloud, broadcast to other terminals
                await broadcastTableMutation(entry.tableNumber, entry.action === "DELETE" ? "DELETE" : "UPSERT");
                outboxQueue.shift();
                processed++;
            } catch (err) {
                entry.retries++;
                entry.lastError = String(err);
                console.error(`[Outbox] Failed to flush entry ${entry.id}:`, err);
                break; // Stop and retry on next cycle
            }
        }
    } finally {
        isFlushing = false;
    }

    return { processed, remaining: outboxQueue.length };
}
