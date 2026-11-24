"use client";

/**
 * Where this machine is reading from — ONE poll for the whole app.
 *
 * Every surface that shows this (the shell badge, the replica gate, the Electron
 * window title, the offline-policies form) reads from a single module-level store fed
 * by a single request to /api/counter/status. Each of them used to run its own
 * `setInterval`, so an open POS screen asked the same question three times every ten
 * seconds and applied the same four side effects three times over.
 *
 * The poll:
 *   • starts when the first consumer mounts, stops when the last one unmounts,
 *   • ticks only while the tab is VISIBLE, and re-reads immediately on becoming
 *     visible again, so returning to the tab never shows a stale light,
 *   • SETTLES to a day-long fallback once the answer cannot change — see
 *     `COUNTER_STATUS_IDLE_POLL_MS` — which is every machine that is not a counter,
 *     and every visitor who is not signed in,
 *   • can be forced at any moment via refreshCounterStatus(), which is how signing in
 *     un-settles a tab that has been sitting on the login screen.
 *
 * Returns `null` until the first answer arrives, and keeps returning a non-counter
 * status on ordinary machines so callers can render nothing. Never throws and never
 * toasts on failure: if this endpoint is unreachable the user already has bigger
 * problems, and a status widget that raises its own errors is pure noise.
 */

import { useSyncExternalStore } from "react";
import axios from "axios";
import { setWritePreference, setReadsGoLocal, setSignalOrigin } from "@/shared/lib/realtime/appChannel";
import { setServedByReplica } from "@/shared/lib/browser/localDb";
import { COUNTER_STATUS_POLL_MS, COUNTER_STATUS_IDLE_POLL_MS } from "@/shared/lib/constants/polling";

/** Mirror of `counterStatus()` in shared/lib/prisma/counterMode.ts. */
export type CounterStatus = {
    mode: "LIVE" | "LOCAL";
    /** READ_MODE — where reads are served from. */
    preference: "live" | "shadow" | "local";
    /** WRITE_MODE — where writes land. `v_live` relays them to the office, then is `live`. */
    writePreference: "live" | "local" | "v_live";
    replicaReady: boolean;
    /**
     * False when the sync worker has HALTED on schema drift. Not-ready then means
     * "this will never finish on its own", which is a different sentence to say.
     */
    replicaSchemaOk: boolean;
    isCounter: boolean;
    replicaSource: "installed" | "embedded" | null;
    /** This PC's name on the change channel; see setSignalOrigin. */
    signalOrigin: string | null;
    /**
     * Whether the last outbox flush reached Supabase.
     *
     * Under WRITE_MODE=local nothing on the request path touches Supabase, so this —
     * not `mode` — is what says whether the counter's work is leaving the machine.
     */
    cloudReachable: boolean;
    lastFlushAt: string | null;
};

// ── the store ────────────────────────────────────────────────────────────────
let state: CounterStatus | null = null;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
/** Current tick length. Starts eager and settles down once the answer is final. */
let intervalMs: number = COUNTER_STATUS_POLL_MS;
/**
 * Settled because nobody is signed in, rather than because this is not a counter.
 *
 * The two look the same from here — both mean "stop asking" — but only this one can
 * be undone from inside the app, and it MUST be: login navigates with `router.push`,
 * so the React tree survives and a poller left idle would never wake up. See
 * `refreshCounterStatus`, called from the login screen's success path.
 */
let settledUnauthenticated = false;

function emit() {
    for (const l of listeners) l();
}

/**
 * How often to ask, given the answer we just got.
 *
 * `isCounter` comes from `IS_COUNTER_PC`, a `const` read once from env, so `false` is
 * final for the life of the server process. Every field a consumer acts on off a
 * counter is likewise env-derived (`preference`, `writePreference`); `mode` and
 * `replicaReady` do change, but every consumer gates on `isCounter` before reading
 * them.
 */
function intervalFor(status: CounterStatus): number {
    return status.isCounter ? COUNTER_STATUS_POLL_MS : COUNTER_STATUS_IDLE_POLL_MS;
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

/** Change the tick length, restarting the timer only when it actually differs. */
function retune(ms: number) {
    if (ms === intervalMs) return;
    intervalMs = ms;
    if (timer) { stopTimer(); startTimer(); }
}

/** Concurrent callers share one request — several consumers mounting together is one fetch. */
function refresh(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = axios
        .get<CounterStatus>("/api/counter/status")
        .then(({ data }) => {
            settledUnauthenticated = false;
            // Where writes land decides who announces them, and — with where reads
            // come from — whether a save is pulled into the replica before the screen
            // re-reads. See setWritePreference.
            setWritePreference(data.writePreference);
            // Where reads come from decides which signal a screen waits for: the
            // replica's "rows applied" line rather than the early Supabase nudge.
            setReadsGoLocal(data.isCounter && data.preference !== "live");
            setSignalOrigin(data.signalOrigin ?? null);
            // Whether the browser's Dexie cache is worth keeping at all. The
            // exact mirror of `shouldReadLocal()` in prisma/counterMode.ts —
            // stricter than setReadsGoLocal above, which deliberately leaves
            // `replicaReady` out, because a counter still reading Supabase
            // WANTS the cache. Takes effect on the next page load, never this
            // one (see setServedByReplica). This endpoint needs a login, so a
            // counter writes nothing before someone signs in — which just
            // leaves the cache behaving as it always has until then.
            setServedByReplica(
                data.isCounter
                && (data.mode === "LOCAL" || (data.replicaReady && data.preference !== "live")),
            );
            state = data;
            retune(intervalFor(data));
            emit();
        })
        .catch((e) => {
            // Not signed in: there is no badge to feed and no counter to describe, so
            // stop asking until someone logs in. Every OTHER failure leaves both the
            // last known status and the current tick alone rather than flashing
            // "unknown" or backing off a counter that is merely mid-restart.
            if (axios.isAxiosError(e) && e.response?.status === 401) {
                settledUnauthenticated = true;
                retune(COUNTER_STATUS_IDLE_POLL_MS);
            }
        })
        .finally(() => { inFlight = null; });
    return inFlight;
}

function onVisibility() {
    if (document.hidden) {
        stopTimer();
    } else {
        // Coming back to the tab is the moment the answer matters most, and the
        // moment it is most likely to be stale.
        void refresh();
        startTimer();
    }
}

/** First mounted consumer wires everything up; the last one to leave tears it down. */
function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
        document.addEventListener("visibilitychange", onVisibility);
        void refresh();
        startTimer();
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            document.removeEventListener("visibilitychange", onVisibility);
            stopTimer();
        }
    };
}

const getSnapshot = () => state;
const getServerSnapshot = (): CounterStatus | null => null;

export function useCounterMode(): CounterStatus | null {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Ask now — for the login screen's success path, and any manual refresh control.
 *
 * Exported as a plain function (not a hook) so any code anywhere can call it; every
 * mounted consumer updates together. Un-settles a tab that backed off because nobody
 * was signed in: `router.push` keeps the React tree alive across login, so without
 * this the badge would stay dark on a counter until the next tab focus.
 */
export function refreshCounterStatus() {
    if (settledUnauthenticated) retune(COUNTER_STATUS_POLL_MS);
    void refresh();
}
