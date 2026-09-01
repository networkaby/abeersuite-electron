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
 *
 * ── Why a write kicks it, instead of a short poll ───────────────────────────
 * The interval used to be 15s, and nothing justified that number: it was copied
 * verbatim from `electron/outboxFlusher.ts`, the predecessor that answered 401 on every
 * push and therefore never retired a single row, so the cadence was never once observed
 * doing anything. Fifteen seconds is pure latency on the only path that gets a
 * counter's sale into the cloud, and it buys nothing: `getPendingOutbox` reads the LOCAL
 * database, so polling is free, and `pushMutations` costs per ROW, not per tick.
 *
 * So the write path kicks instead (`kick.ts`, called from `createLocal`'s extension),
 * debounced by `KICK_DEBOUNCE_MS` so one save's several writes become one push rather
 * than being caught mid-transaction by an arbitrary tick. The interval stays as the
 * safety net at a minute, because the kick sits at the Prisma layer and cannot see raw
 * SQL — the same blind spot that moved outbox CAPTURE onto Postgres triggers. Capture is
 * still exact; only the prompt is best-effort.
 */

import { getPendingOutbox, markOutboxPushed, markOutboxFailure } from "./outbox";
import { pushMutations } from "./push";
import { setOutboxKick } from "./kick";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { ALL_TOPICS } from "@/shared/lib/realtime/topics";

/** The safety net, not the mechanism — see the note above. */
const FLUSH_INTERVAL_MS = 60_000;
/** Long enough to gather one save's writes, short enough that a sale is up in ~1s. */
const KICK_DEBOUNCE_MS = 1_000;
const BATCH_SIZE = 50;

let timer: NodeJS.Timeout | null = null;
let kickTimer: NodeJS.Timeout | null = null;
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
            // THE announcement for a counter's writes. The browser stayed silent when it
            // saved (see appChannel.setWritesGoLocal), because at that moment the row was
            // only in this machine's _outbox — anyone acting on it would have pulled
            // Supabase about a second too early, found nothing, and never been told
            // again. Now the row genuinely exists for others to read, so say so: their
            // workers pull, and their screens are woken by their OWN replica landing the
            // rows (`__SYNC_APPLIED__`), while an office reading Supabase directly
            // refetches straight away.
            //
            // Best-effort by contract — a missed announcement costs latency, never data,
            // because every consumer still has its own interval and reconcile pass.
            void publishChangeServer(ALL_TOPICS);
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

    // A local write asks for a flush soon. Debounced, and a no-op while one is
    // already scheduled, so a burst of writes still produces a single push.
    setOutboxKick(() => {
        if (kickTimer) return;
        kickTimer = setTimeout(() => {
            kickTimer = null;
            void flushOnce(localUrl);
        }, KICK_DEBOUNCE_MS);
        kickTimer.unref?.();
    });
}

export function stopOutboxFlusher(): void {
    if (kickTimer) {
        clearTimeout(kickTimer);
        kickTimer = null;
    }
    setOutboxKick(() => {});
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}
