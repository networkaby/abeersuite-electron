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
 *  • NOTHING RUNS WHILE THE TAB IS HIDDEN, but a hidden tab ALWAYS gets one read
 *    the instant it is looked at again — unconditionally, not only when a signal
 *    happened to arrive while it was away. A quiet channel is ambiguous: it could
 *    mean nothing changed, or it could mean this machine's connection was down
 *    the whole time (the browser minimized, the leader tab's timers throttled —
 *    see `appChannel.ts`'s `msSinceLastLive`). Silence can't be trusted to mean
 *    "nothing to do," so the read on return isn't conditional on remembering a
 *    signal; it is exactly `usePolling`'s own "fires once immediately on becoming
 *    visible again," just triggered by a change channel instead of a timer.
 *
 *  • ONE READ PER BURST. Posting a voucher can announce itself more than once
 *    (post, then allocate); a settle window collapses that into a single re-read.
 *
 * `fn` may change identity between renders — the latest one is always used and
 * the subscription is not rebuilt for it, so callers need not memoise.
 */

import { useEffect, useRef } from "react";
import { onChangeSignal } from "@/shared/lib/realtime/appChannel";
import { subscribeToSyncEvents } from "@/shared/lib/sync/realtimeSync";
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

        const run = () => {
            timer = null;
            fnRef.current();
        };

        const schedule = () => {
            if (document.hidden || timer) return;
            timer = setTimeout(run, SETTLE_MS);
        };

        const offApp = onChangeSignal((sig) => {
            if (!sig.topics.some((t) => wanted.has(t))) return;
            schedule();
        });

        // Listen to selective delta sync events across terminals
        const offSync = subscribeToSyncEvents(() => {
            schedule();
        });

        // Listen to local in-app mutation deltas
        const onLocalDelta = () => schedule();
        if (typeof window !== "undefined") {
            window.addEventListener("app:live-delta", onLocalDelta);
        }

        // A gap this tab sat hidden through is exactly what a remembered
        // "owed" flag would try to cover — and get wrong the moment the gap
        // held no signal at all. Reading unconditionally on return is both
        // simpler and actually safe.
        const onVisibility = () => { if (!document.hidden) run(); };
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            offApp();
            offSync();
            if (typeof window !== "undefined") {
                window.removeEventListener("app:live-delta", onLocalDelta);
            }
            if (timer) clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [key, enabled]);
}
