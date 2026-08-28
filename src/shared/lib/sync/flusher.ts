/**
 * Drains the local `_outbox` to Supabase, on a timer, inside the Next server.
 *
 * ── Why it moved here from Electron ─────────────────────────────────────────
 * It used to live in `electron/outboxFlusher.ts`, which POSTed the batch to
 * `http://127.0.0.1:786/api/sync/push`. That endpoint calls `requireAuth()`, and the
 * Electron main process has no session cookie — so every push returned 401, the
 * flusher logged nothing (its catch was empty) and returned 0. The outbox could never
 * drain, and nothing said so.
 *
 * Running the loop in the Next server removes the problem rather than working around
 * it: this process already holds both database connections, so there is no HTTP hop to
 * authenticate and no credential to put on a shop PC. `/api/sync/push` stays for a
 * future pusher that genuinely arrives over the network.
 *
 * ── Lifecycle ───────────────────────────────────────────────────────────────
 * Started once from `instrumentation.ts`, and only on a counter (LOCAL_DATABASE_URL
 * set). A single in-flight guard means a slow batch cannot overlap the next tick.
 */

import { getPendingOutbox, markOutboxPushed, markOutboxFailure } from "./outbox";
import { pushMutations } from "./push";

const FLUSH_INTERVAL_MS = 15_000;
const BATCH_SIZE = 50;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

/**
 * Whether the last flush reached Supabase.
 *
 * With reads and writes both served locally, a failing push is the only remaining
 * evidence that the cloud is unreachable — nothing else on the request path touches
 * it. The status endpoint reports this rather than running a separate heartbeat.
 */
let cloudReachable = true;
let lastFlushAt: number | null = null;

export function getPushHealth(): { cloudReachable: boolean; lastFlushAt: string | null } {
    return {
        cloudReachable,
        lastFlushAt: lastFlushAt ? new Date(lastFlushAt).toISOString() : null,
    };
}

/**
 * One pass. Returns the number of mutations retired.
 *
 * The batch stops at the first failure (see push.ts on ordering), so a run can retire
 * fewer rows than it fetched. The stuck row is backed off and eventually dead-lettered,
 * which is what lets the queue behind it move.
 */
export async function flushOnce(localUrl: string): Promise<number> {
    if (inFlight) return 0;
    inFlight = true;
    try {
        const pending = await getPendingOutbox(localUrl, BATCH_SIZE);
        if (pending.length === 0) return 0;

        const { pushedIds, failure } = await pushMutations(pending);

        if (pushedIds.length > 0) await markOutboxPushed(localUrl, pushedIds);
        if (failure) {
            await markOutboxFailure(localUrl, failure.id, failure.error, failure.permanent);
        }

        // A push that got a real answer from Supabase — success or a rejection it
        // generated — proves the connection. Only a transport failure means offline,
        // and a permanent rejection is emphatically not one.
        cloudReachable = pushedIds.length > 0 || Boolean(failure?.permanent);
        lastFlushAt = Date.now();

        if (pushedIds.length > 0) {
            console.log(`[OutboxFlusher] pushed ${pushedIds.length} mutation(s).`);
        }
        return pushedIds.length;
    } catch (err) {
        // Normal while offline. Logged once per tick rather than swallowed entirely —
        // the previous version's empty catch is why a 401 on every single push went
        // unnoticed for the life of the feature.
        cloudReachable = false;
        console.warn("[OutboxFlusher] flush failed:", err instanceof Error ? err.message : err);
        return 0;
    } finally {
        inFlight = false;
    }
}

export function startOutboxFlusher(localUrl: string): void {
    if (timer) return;
    console.log("[OutboxFlusher] starting in-process outbox flusher.");
    timer = setInterval(() => {
        void flushOnce(localUrl);
    }, FLUSH_INTERVAL_MS);
    // Must not hold the process open on its own.
    timer.unref?.();
}

export function stopOutboxFlusher(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}
