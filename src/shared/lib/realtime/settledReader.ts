"use client";

/**
 * The three habits every change-driven re-read shares, in one place.
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
 *
 * Factored out so a caller listening to BOTH the local replica and the Supabase
 * channel shares ONE timer and ONE visibility listener. Two readers would mean two
 * reads every time the user comes back to the window.
 */

/** Long enough to swallow a multi-request save, short enough to feel instant. */
export const SETTLE_MS = 600;

export type SettledReader = {
    /** Ask for a read. Ignored while hidden, or while one is already pending. */
    schedule: () => void;
    /** Drop the timer and the visibility listener. */
    dispose: () => void;
};

export function createSettledReader(fn: () => void, settleMs: number = SETTLE_MS): SettledReader {
    if (typeof document === "undefined") return { schedule: () => {}, dispose: () => {} };

    let timer: ReturnType<typeof setTimeout> | null = null;

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
        fn();
    };

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
            document.removeEventListener("visibilitychange", onVisibility);
        },
    };
}
