"use client";

/**
 * useRealtimeTopics — re-read when someone ELSEWHERE changed something you care about.
 *
 * The sibling of `usePolling`, and the reason a surface can stop polling: instead
 * of asking the database every N seconds whether anything moved, the screen sits
 * silent until a change actually happens and then reads once. A Day Book with
 * nothing going on costs nothing.
 *
 * It keeps `usePolling`'s two habits, for the same cost reasons:
 *
 *  • NOTHING RUNS WHILE THE TAB IS HIDDEN. A signal arriving at a background tab
 *    is remembered, not acted on; the re-read happens when the tab is looked at
 *    again. Ten tabs open behind a window are ten refetches we don't pay for, and
 *    the user sees current figures the moment they look either way.
 *
 *  • ONE READ PER BURST. Posting a voucher can announce itself more than once
 *    (post, then allocate); a settle window collapses that into a single re-read.
 *
 * `fn` may change identity between renders — the latest one is always used and
 * the subscription is not rebuilt for it, so callers need not memoise.
 */

import { useEffect, useRef } from "react";
import { onChangeSignal } from "@/shared/lib/realtime/appChannel";
import type { Topic } from "@/shared/lib/realtime/topics";

/** Long enough to swallow a multi-request save, short enough to feel instant. */
const SETTLE_MS = 600;

export function useRealtimeTopics(
    topics: readonly Topic[],
    fn: () => void,
    enabled = true,
) {
    const fnRef = useRef(fn);
    useEffect(() => { fnRef.current = fn; });

    // Identity-stable key so re-rendering with a fresh array literal — which
    // every caller does — does not tear the subscription down and build it again.
    const key = [...topics].sort().join(",");

    useEffect(() => {
        if (!enabled || key === "") return;
        const wanted = new Set(key.split(","));

        let timer: ReturnType<typeof setTimeout> | null = null;
        /** A signal arrived while hidden; owed a read when the tab comes back. */
        let owed = false;

        const run = () => {
            timer = null;
            owed  = false;
            fnRef.current();
        };

        const schedule = () => {
            if (document.hidden) { owed = true; return; }
            if (timer) return;
            timer = setTimeout(run, SETTLE_MS);
        };

        const off = onChangeSignal((sig) => {
            if (!sig.topics.some((t) => wanted.has(t))) return;
            schedule();
        });

        const onVisibility = () => {
            if (document.hidden || !owed) return;
            run();
        };
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            off();
            if (timer) clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [key, enabled]);
}
