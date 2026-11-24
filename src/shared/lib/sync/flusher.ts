/**
 * Drains the local `_outbox` to Supabase, inside the Next server.
 *
 * ── Why it lives here rather than in Electron ───────────────────────────────
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
 * ── What wakes it: the database itself, at commit ───────────────────────────
 * The `_outbox_capture` trigger (scripts/gen-local-schema.ts) ends with
 * `pg_notify('outbox_changed')`. Postgres delivers a NOTIFY only when the sending
 * transaction COMMITS, and collapses identical notifications inside one transaction —
 * so a voucher that writes twelve rows produces one wake-up, at exactly the moment the
 * rows become visible to another connection.
 *
 * That replaces a Prisma-layer "kick" debounced by 1 s. The kick fired after each
 * query, before the enclosing transaction committed, and the second was a guess at how
 * long the commit takes: a slow commit meant the flush found nothing and the sale waited
 * for the interval, a fast one wasted most of the second, and a kick that landed during
 * a flush was dropped. The notification cannot be early, cannot be late, and covers raw
 * SQL that the Prisma layer never saw.
 *
 * ── Lifecycle ───────────────────────────────────────────────────────────────
 * Started once from `instrumentation.ts`, only on a counter (LOCAL_DATABASE_URL set).
 * One dedicated `pg` client holds `LISTEN outbox_changed` and reconnects with a backoff
 * if it drops. A notification that arrives mid-flush queues exactly one more pass, so a
 * write that commits while the previous batch is being pushed is never left for the
 * interval. The interval itself stays as the safety net for the reconnect gap.
 */

import {
    getPendingOutbox, markOutboxPushed, markOutboxFailure, markOutboxUnreachable,
    rejectAllPending, requeueUnreachableDeadLetters,
} from "./outbox";
import { pushMutations } from "./push";
import { isThisPcReleased } from "@/shared/lib/counter/releaseGuard";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { ALL_TOPICS } from "@/shared/lib/realtime/topics";
import { connectionErrorText } from "./connectionError";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: PgClient } = require("pg") as typeof import("pg");

// ── Tuning ───────────────────────────────────────────────────────────────────

/**
 * Safety-net poll. Not the mechanism: the NOTIFY above is. This only has to cover the
 * moments the listener is reconnecting. A tick reads the LOCAL database and touches
 * Supabase only when there is something to push, so it costs no egress when idle —
 * 30 s or 60 s are both fine.
 */
const FLUSH_INTERVAL_MS = 60_000;

/** Rows per push. `pushMutations` costs per row, not per call. */
const BATCH_SIZE = 50;

/** Must match `pg_notify` in the `_outbox_capture` trigger. */
const CHANNEL = "outbox_changed";

/** Wait before re-opening a dropped LISTEN connection. */
const LISTEN_RETRY_MS = 5_000;

// ── State ────────────────────────────────────────────────────────────────────
//
// One flusher per server PROCESS, not per module copy. The bundler gives
// instrumentation (which starts the flusher) and each route handler (which reads
// its health — /api/counter/status) their OWN copy of this module, so module-level
// state meant the status route read a copy that never ran: "reachable, never
// flushed", however long uploads had been failing. Parked on `globalThis`, every
// copy shares the one that runs — and a second copy can never start a second
// flusher or a second LISTEN. Same pattern as replicaPull.ts.

type FlusherState = {
    timer: NodeJS.Timeout | null;
    listener: InstanceType<typeof PgClient> | null;
    listenRetry: NodeJS.Timeout | null;
    stopped: boolean;
    inFlight: boolean;
    /** A notification arrived while a flush was running: go once more when it ends. */
    queued: boolean;
    /**
     * Whether the last flush reached Supabase.
     *
     * With reads and writes both served locally, a failing push is the only remaining
     * evidence that the cloud is unreachable — nothing else on the request path touches
     * it. The status endpoint reports this rather than running a separate heartbeat.
     */
    cloudReachable: boolean;
    lastFlushAt: number | null;
    /**
     * Whether this process has swept the outage dead letters an older build left behind
     * (see `requeueUnreachableDeadLetters`). Set only when the sweep actually ran: the
     * first attempt comes as the app boots, when the replica is at its busiest, and a
     * one-shot there failed on a real till and left the red badge standing.
     */
    strandedSwept: boolean;
};

const globalForFlusher = globalThis as unknown as { __outboxFlusher?: FlusherState };
const S: FlusherState = (globalForFlusher.__outboxFlusher ??= {
    timer: null,
    listener: null,
    listenRetry: null,
    stopped: true,
    inFlight: false,
    queued: false,
    cloudReachable: true,
    lastFlushAt: null,
    strandedSwept: false,
});

export function getPushHealth(): { cloudReachable: boolean; lastFlushAt: string | null } {
    return {
        cloudReachable: S.cloudReachable,
        lastFlushAt: S.lastFlushAt ? new Date(S.lastFlushAt).toISOString() : null,
    };
}

/**
 * One pass. Returns the number of mutations retired.
 *
 * The batch stops at the first failure (see push.ts on ordering), so a run can retire
 * fewer rows than it fetched. A REFUSED row is backed off and eventually dead-lettered,
 * which is what lets the queue behind it move. A row that failed only because Supabase
 * was unreachable keeps its place and spends no attempt: it is retried on the next pass,
 * for as long as the outage lasts.
 *
 * Re-entrant by design: a call that lands mid-flush does not run a second pass in
 * parallel (two passes would push the same rows), it queues exactly one more.
 */
export async function flushOnce(localUrl: string): Promise<number> {
    if (S.inFlight) {
        S.queued = true;
        return 0;
    }
    S.inFlight = true;
    try {
        // Before the first pass, and every pass until it gets through. It runs inside the
        // flush so the rows it re-queues are pushed by this very pass, in id order.
        if (!S.strandedSwept) {
            const swept = await requeueUnreachableDeadLetters(localUrl);
            if (swept) {
                S.strandedSwept = true;
                if (swept.requeued > 0 || swept.superseded > 0) {
                    console.log(
                        `[OutboxFlusher] re-queued ${swept.requeued} row(s) dead-lettered by an outage` +
                        (swept.superseded > 0 ? `; retired ${swept.superseded} superseded by a later save.` : "."),
                    );
                }
            }
        }

        const pending = await getPendingOutbox(localUrl, BATCH_SIZE);
        if (pending.length === 0) return 0;

        // A released counter pushes NOTHING. Asked of Supabase itself, fresh — the
        // replica still says "bound" at the moment a PC reconnects after hours offline,
        // and this is the one place a stale answer would let refused work through. Only
        // a positive "released" refuses; unreachable falls through to a push that fails
        // offline exactly as it always has. See releaseGuard.ts.
        if (await isThisPcReleased({ authoritative: true, force: true })) {
            const refused = await rejectAllPending(localUrl, "rejected: counter released by admin");
            console.warn(`[OutboxFlusher] rejected ${refused} pending mutation(s): this counter was released by admin.`);
            // Supabase answered, so the cloud IS reachable — the badge must not go red.
            S.cloudReachable = true;
            S.lastFlushAt = Date.now();
            return 0;
        }

        const { pushedIds, failure } = await pushMutations(pending);

        if (pushedIds.length > 0) await markOutboxPushed(localUrl, pushedIds);
        if (failure?.unreachable) {
            await markOutboxUnreachable(localUrl, failure.id, failure.error);
        } else if (failure) {
            await markOutboxFailure(localUrl, failure.id, failure.error, failure.permanent);
        }

        // A push that got a real answer from Supabase — success or a rejection it
        // generated — proves the connection. Only a transport failure means offline.
        S.cloudReachable = pushedIds.length > 0 || !failure?.unreachable;
        S.lastFlushAt = Date.now();

        if (pushedIds.length > 0) {
            console.log(`[OutboxFlusher] pushed ${pushedIds.length} mutation(s).`);
            // THE announcement for a counter's writes. The browser stayed silent when it
            // saved (see appChannel.setWritePreference), because at that moment the row was
            // only in this machine's _outbox — anyone acting on it would have pulled
            // Supabase about a second too early, found nothing, and never been told
            // again. Now the row genuinely exists for others to read, so say so: their
            // workers pull, and their screens are woken by their OWN replica landing the
            // rows (`__SYNC_APPLIED__`), while an office reading Supabase directly
            // refetches straight away.
            //
            // Best-effort by contract — a missed announcement costs latency, never data,
            // because every consumer still has its own interval and reconcile pass.
            // These rows came FROM this replica, so this PC's own worker defers the echo.
            const origin = process.env.COUNTER_SIGNAL_ORIGIN;
            void publishChangeServer(ALL_TOPICS, origin ? { origin } : {});
        }
        // A full batch means there is probably more behind it; do not wait for a
        // notification that already fired, or for the interval.
        if (pending.length === BATCH_SIZE && pushedIds.length > 0) S.queued = true;
        return pushedIds.length;
    } catch (err) {
        // Normal while offline. Logged once per pass rather than swallowed entirely —
        // the previous version's empty catch is why a 401 on every single push went
        // unnoticed for the life of the feature.
        S.cloudReachable = false;
        console.warn("[OutboxFlusher] flush failed:", err instanceof Error ? err.message : err);
        return 0;
    } finally {
        S.inFlight = false;
        if (S.queued && !S.stopped) {
            S.queued = false;
            setImmediate(() => { void flushOnce(localUrl); });
        }
    }
}

/**
 * Hold `LISTEN outbox_changed` on its own connection. A `pg` client that is listening
 * cannot also run queries safely, so this one does nothing else.
 *
 * Never throws: a listener that cannot connect just retries, and the interval keeps
 * pushing meanwhile.
 */
function startListener(localUrl: string): void {
    if (S.stopped || S.listener) return;

    const client = new PgClient({ connectionString: localUrl, connectionTimeoutMillis: 5_000 });
    S.listener = client;

    const dropAndRetry = (why: string) => {
        if (S.listener !== client) return; // already replaced or stopped
        S.listener = null;
        client.end().catch(() => { });
        if (S.stopped) return;
        console.warn(`[OutboxFlusher] listener ${why}; reconnecting in ${LISTEN_RETRY_MS / 1000}s.`);
        S.listenRetry = setTimeout(() => {
            S.listenRetry = null;
            startListener(localUrl);
        }, LISTEN_RETRY_MS);
        S.listenRetry.unref?.();
    };

    client.on("notification", (msg) => {
        if (msg.channel === CHANNEL) void flushOnce(localUrl);
    });
    client.on("error", (err) => dropAndRetry(`error: ${connectionErrorText(err)}`));
    client.on("end", () => dropAndRetry("connection closed"));

    client.connect()
        .then(() => client.query(`LISTEN ${CHANNEL}`))
        .then(() => {
            console.log(`[OutboxFlusher] listening on ${CHANNEL}.`);
            // Anything that committed while we were not listening.
            void flushOnce(localUrl);
        })
        .catch((err: unknown) => dropAndRetry(`could not connect: ${connectionErrorText(err)}`));
}

export function startOutboxFlusher(localUrl: string): void {
    if (S.timer) return;
    S.stopped = false;
    console.log("[OutboxFlusher] starting in-process outbox flusher.");

    S.timer = setInterval(() => {
        void flushOnce(localUrl);
    }, FLUSH_INTERVAL_MS);
    // Must not hold the process open on its own.
    S.timer.unref?.();

    startListener(localUrl);
}

/**
 * Stops the flusher and resolves once no batch is on the wire. A batch already pushed
 * gets to mark its rows pushed, so the next boot does not send them again — harmless
 * (last-write-wins drops an equal stamp) but avoidable. The desktop app asks for this on
 * quit (instrumentation.ts) and bounds the wait itself.
 */
export async function stopOutboxFlusher(): Promise<void> {
    S.stopped = true;
    S.queued = false;
    if (S.listenRetry) {
        clearTimeout(S.listenRetry);
        S.listenRetry = null;
    }
    if (S.listener) {
        const client = S.listener;
        S.listener = null;
        client.end().catch(() => { });
    }
    if (S.timer) {
        clearInterval(S.timer);
        S.timer = null;
    }
    while (S.inFlight) await new Promise((r) => setTimeout(r, 50));
}
