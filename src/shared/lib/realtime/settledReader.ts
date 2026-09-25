"use client";

/**
 * The four habits every change-driven re-read shares, in one place.
 *
 *  • ONE READ PER BURST. Posting a voucher announces itself more than once (post,
 *    then allocate, then the worker's cycle); a settle window collapses that into
 *    a single re-read instead of three.
 *  • NOTHING RUNS WHILE THE WINDOW IS HIDDEN. A screen nobody is looking at costs
 *    nothing — AGENTS.md §7, reads are the expensive part.
 *  • ALWAYS ONE READ ON COMING BACK, unconditionally. Silence while hidden is
 *    ambiguous: it could mean nothing changed, or that this machine's link was
 *    down the whole time. A remembered "owed" flag gets that wrong exactly when
 *    the gap held no signal, so the read on return is not conditional on one.
 *  • A SLOW HEARTBEAT UNDERNEATH, so a screen is never stale for longer than
 *    SCREEN_HEARTBEAT_MS no matter what happened to the signal. Everything above is
 *    event-driven, and an event can simply not arrive — the Supabase channel
 *    dropped and reconnected, the leader tab's timers were throttled, a write
 *    took a path whose topics nobody mapped. The replica has a verify sweep for
 *    exactly this reason; the UI now has its own. It is a floor, not the
 *    mechanism: a signal still reads in 600 ms, and a window nobody is looking
 *    at still costs nothing.
 *
 * Factored out so a caller listening to BOTH the local replica and the Supabase
 * channel shares ONE timer and ONE visibility listener. Two readers would mean two
 * reads every time the user comes back to the window.
 */

import { SCREEN_HEARTBEAT_MS } from "@/shared/lib/constants/polling";

/** Long enough to swallow a multi-request save, short enough to feel instant. */
export const SETTLE_MS = 600;

/**
 * ±20% spread on the heartbeat. A busy screen mounts several subscribers at once
 * and, on a fixed period, they would all wake in the same millisecond every five
 * minutes — a self-inflicted thundering herd against the same database. The jitter
 * is picked once per reader, so each one keeps its own steady rhythm.
 */
function jittered(base: number): number {
    return Math.round(base * (0.8 + Math.random() * 0.4));
}

export type SettledReader = {
    /** Ask for a read. Ignored while hidden, or while one is already pending. */
    schedule: () => void;
    /** Drop the timer and the visibility listener. */
    dispose: () => void;
};

export function createSettledReader(
    fn: () => void,
    settleMs: number = SETTLE_MS,
    heartbeatMs: number = SCREEN_HEARTBEAT_MS,
): SettledReader {
    if (typeof document === "undefined") return { schedule: () => {}, dispose: () => {} };

    let timer: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setTimeout> | null = null;
    const period = jittered(heartbeatMs);

    // Cancels a pending read before doing this one, because `run` has two callers
    // and one of them jumps the queue. A signal arriving while the window is visible
    // starts a 600 ms timer; if the user then looks away and back inside that window,
    // the visibility handler reads AT ONCE and the timer still fires afterwards — two
    // reads for one change, on every subscribed screen. Clearing a handle that has
    // already fired is a harmless no-op, so the timer's own call is unaffected, and
    // `timer` now always reflects reality so `dispose` can really cancel it. Without
    // that, a read could land after the screen was closed.
    const run = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        // Any read — signalled, on return, or from the heartbeat itself — resets
        // the floor. The heartbeat is the LAST resort, so a screen kept fresh by
        // signals never fires it at all.
        armHeartbeat();
        fn();
    };

    // Re-armed rather than left on an interval: an interval keeps ticking while
    // hidden, and a window brought back after an hour would then fire a backlog
    // of them at once. A fresh timeout each time means at most one pending wake.
    function armHeartbeat() {
        if (heartbeat) clearTimeout(heartbeat);
        heartbeat = setTimeout(() => {
            heartbeat = null;
            // Hidden: the visibility handler will read on return, so nothing is
            // owed here. Re-arm only, to be ready once the window is looked at.
            if (document.hidden) { armHeartbeat(); return; }
            run();
        }, period);
    }
    armHeartbeat();

    const schedule = () => {
        if (document.hidden || timer) return;
        timer = setTimeout(run, settleMs);
    };

    const onVisibility = () => {
        if (!document.hidden) run();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return {
        schedule,
        dispose() {
            if (timer) clearTimeout(timer);
            if (heartbeat) clearTimeout(heartbeat);
            document.removeEventListener("visibilitychange", onVisibility);
        },
    };
}
