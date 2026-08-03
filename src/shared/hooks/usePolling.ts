"use client";

/**
 * usePolling — a background refresh that stops when nobody is looking.
 *
 * A plain `setInterval` keeps hitting the database from tabs sitting behind other
 * windows all day, which is pure egress for zero benefit. This hook:
 *   • runs `fn` once on mount,
 *   • polls every `intervalMs` only while the tab is VISIBLE,
 *   • clears the timer the moment the tab is hidden, and
 *   • fires `fn` immediately when the tab becomes visible again, so what the user
 *     sees on returning is fresh — never a stale badge from before they left.
 *
 * `fn` may change identity between renders; the latest one is always used and the
 * timer is not restarted for it. Pass `enabled: false` to hold off entirely (e.g.
 * until a permission check has resolved), and `resetKey` when something `fn` reads
 * has changed (a filter, a selected branch) and the new data is wanted now rather
 * than at the next tick.
 */

import { useEffect, useRef } from "react";

export function usePolling(
    fn: () => void,
    intervalMs: number,
    enabled = true,
    resetKey?: unknown,
) {
    const fnRef = useRef(fn);
    // Kept current in an effect, not during render — the timer below reads it, so
    // it must never be written while React is rendering.
    useEffect(() => { fnRef.current = fn; });

    useEffect(() => {
        if (!enabled) return;

        let timer: ReturnType<typeof setInterval> | null = null;

        const run = () => fnRef.current();

        const start = () => {
            if (timer) return;
            timer = setInterval(run, intervalMs);
        };
        const stop = () => {
            if (!timer) return;
            clearInterval(timer);
            timer = null;
        };

        const onVisibility = () => {
            if (document.hidden) {
                stop();
            } else {
                run();   // catch up on whatever was missed while hidden
                start();
            }
        };

        run();
        if (!document.hidden) start();
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [intervalMs, enabled, resetKey]);
}
