"use client";

/**
 * Both directions of this counter's sync — ONE poll for the whole app.
 *
 * Was `useOutboxStatus`, which reported only the push side. The name changed with
 * the scope: a badge that says "Synced" while the replica underneath it has
 * stopped receiving is worse than no badge, because people believe it.
 *
 * Three sources, each answering something the others cannot:
 *
 *  1. `/api/sync/status` — the outbox counts (did MY writes leave) and the
 *     replica's own health (has it ever synced these tables, is anything
 *     failing). Polled, because both are slow-moving facts.
 *  2. `app:changes` — somebody elsewhere saved something. This is the ONLY
 *     signal that a download is owed; the replica cannot know it without
 *     asking Supabase. Coarse by design: topics are 8 domain buckets, never
 *     table names (see realtime/topics.ts).
 *  3. `__SYNC_APPLIED__` via `syncApplied.ts` — the worker reporting that
 *     pulled rows are committed and queryable. Clears (2).
 *
 * All three now live in a module-level store shared by every consumer — the shell
 * badge, the finance top bar, the replica gate and the Electron window title. Each
 * used to hold its own copy, so one `app:changes` signal started three independent
 * expiry timers and a POS screen ran three polls of the same endpoint. The poll
 * starts with the first consumer, stops with the last, ticks only while the tab is
 * visible, and settles to a day-long fallback once the answer cannot change — see
 * `useCounterMode`, which follows the same shape and carries the fuller note.
 */

import { useSyncExternalStore } from "react";
import axios from "axios";
import { onChangeSignal, type ChangeSignal } from "@/shared/lib/realtime/appChannel";
import { ensureSyncAppliedBridge, SYNC_APPLIED_EVENT } from "@/shared/lib/realtime/syncApplied";
import type { Topic } from "@/shared/lib/realtime/topics";
import { COUNTER_STATUS_POLL_MS, COUNTER_STATUS_IDLE_POLL_MS } from "@/shared/lib/constants/polling";

/** The replica's account of itself. Mirrors `ReplicaLagResult`. */
export type ReplicaHealth = {
    neverSynced: string[];
    failing: string[];
    lastCycleAt: string | null;
    ready: boolean;
    tablesSynced: number;
    tablesTotal: number;
};

/** Mirror of the JSON shape returned by /api/sync/status. */
export type ApiSyncStatus = {
    isCounter: boolean;
    /** Captured writes not yet pushed, excluding dead-lettered ones. */
    pending: number;
    /** DEAD-LETTERED writes: given up on, and the one state needing a human. */
    failed: number;
    /** Pending writes that have failed at least once and are backing off. */
    retrying: number;
    lastSyncedAt: string | null;
    /** Null off a counter PC, where there is no replica to describe. */
    replica: ReplicaHealth | null;
    /**
     * Gift cards whose balance has gone below zero: two tills drew the same card
     * while apart, and the rebuild from the txn ledger summed both. Needs a person.
     */
    overdrawnGiftCards: number;
};

/**
 * What the hook returns: the polled shape plus the live download claim, which is
 * browser-only state and never comes back from the server.
 */
export type SyncStatus = ApiSyncStatus & {
    /** Topics announced since the worker last confirmed a commit. Empty when idle. */
    downloading: Topic[];
};

/**
 * How long a "download owed" claim may stand without the worker confirming it.
 *
 * `__SYNC_APPLIED__` is SILENT when a cycle pulled nothing (sync-once.js only
 * prints it for `pulledTotal > 0`), and a signal often describes a change this
 * counter already has — someone re-saving a row it pulled a minute ago. Without a
 * cap those cases would pin the badge to "Downloading" permanently, which is
 * exactly the kind of indicator that teaches people to ignore indicators.
 *
 * Generous rather than tight: a cycle settles 750ms and then scans every
 * registered table, so a slow one takes seconds. This is a backstop for the
 * silent case, not the normal clear path.
 */
const DOWNLOAD_CLAIM_TTL_MS = 30_000;

// ── the store ────────────────────────────────────────────────────────────────
/** The polled half. */
let api: ApiSyncStatus | null = null;
/** The live half: topics announced since the worker last confirmed a commit. */
let downloading: Topic[] = [];
/**
 * The two halves composed, rebuilt only when one of them changes.
 *
 * `useSyncExternalStore` compares snapshots by identity, so this CANNOT be built
 * fresh on each read — that would re-render every consumer forever.
 */
let state: SyncStatus | null = null;

const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let intervalMs: number = COUNTER_STATUS_POLL_MS;
/** See the note on the same flag in `useCounterMode`. */
let settledUnauthenticated = false;
let expiry: ReturnType<typeof setTimeout> | null = null;
let unsubscribeChangeSignal: (() => void) | null = null;

function compose() {
    state = api ? { ...api, downloading } : null;
    for (const l of listeners) l();
}

function startTimer() {
    if (timer || (typeof document !== "undefined" && document.hidden)) return;
    timer = setInterval(() => { void refresh(); }, intervalMs);
}
function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}
function retune(ms: number) {
    if (ms === intervalMs) return;
    intervalMs = ms;
    if (timer) { stopTimer(); startTimer(); }
}

function refresh(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = axios
        .get<ApiSyncStatus>("/api/sync/status")
        .then(({ data }) => {
            settledUnauthenticated = false;
            api = data;
            // Off a counter this endpoint short-circuits on IS_COUNTER_PC before it
            // touches a database, and that const cannot change while the server runs.
            retune(data.isCounter ? COUNTER_STATUS_POLL_MS : COUNTER_STATUS_IDLE_POLL_MS);
            compose();
        })
        .catch((e) => {
            // Nobody signed in — nothing to report and nothing to wait for. Any other
            // failure leaves the last known status in place rather than flashing
            // "unknown".
            if (axios.isAxiosError(e) && e.response?.status === 401) {
                settledUnauthenticated = true;
                retune(COUNTER_STATUS_IDLE_POLL_MS);
            }
        })
        .finally(() => { inFlight = null; });
    return inFlight;
}

// ── The transient "a download is owed" window ────────────────────────────────
// Only meaningful where a worker exists to owe it: off a counter the browser reads
// Supabase directly, so there is no replica to be behind and a signal implies
// nothing to wait for.

function clearClaim() {
    if (expiry) { clearTimeout(expiry); expiry = null; }
    if (!downloading.length) return;
    downloading = [];
    compose();
}

function onSignal(sig: ChangeSignal) {
    if (!api?.isCounter || !sig.topics.length) return;
    const merged = new Set([...downloading, ...sig.topics]);
    if (merged.size !== downloading.length) {
        downloading = [...merged];
        compose();
    }
    if (expiry) clearTimeout(expiry);
    expiry = setTimeout(clearClaim, DOWNLOAD_CLAIM_TTL_MS);
}

/** The worker committed rows, so whatever was owed has landed. */
const onApplied = () => clearClaim();

function onVisibility() {
    if (document.hidden) {
        stopTimer();
    } else {
        void refresh();
        startTimer();
    }
}

/** First mounted consumer wires everything up; the last one to leave tears it down. */
function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
        document.addEventListener("visibilitychange", onVisibility);
        unsubscribeChangeSignal = onChangeSignal(onSignal);
        ensureSyncAppliedBridge();
        window.addEventListener(SYNC_APPLIED_EVENT, onApplied);
        void refresh();
        startTimer();
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            document.removeEventListener("visibilitychange", onVisibility);
            unsubscribeChangeSignal?.();
            unsubscribeChangeSignal = null;
            window.removeEventListener(SYNC_APPLIED_EVENT, onApplied);
            stopTimer();
            if (expiry) { clearTimeout(expiry); expiry = null; }
        }
    };
}

const getSnapshot = () => state;
const getServerSnapshot = (): SyncStatus | null => null;

export function useSyncStatus(): SyncStatus | null {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Ask now — see `refreshCounterStatus`, which this mirrors. */
export function refreshSyncStatus() {
    if (settledUnauthenticated) retune(COUNTER_STATUS_POLL_MS);
    void refresh();
}
