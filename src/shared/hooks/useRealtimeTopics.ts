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
 *
 * TWO SOURCES, NOT ONE. On a counter the change signal fires while the sync worker is
 * still writing the replica these screens read from, so acting on it alone means reading
 * too early and showing the old rows. `syncApplied.ts` supplies the second source — the
 * worker reporting that rows are committed and queryable — and that one is filtered only
 * by "did anything change on this machine", not by topic. Off Electron it never fires.
 */

import { useEffect, useRef } from "react";
import { onChangeSignal, getReadsGoLocal } from "@/shared/lib/realtime/appChannel";
import { ensureSyncAppliedBridge, SYNC_APPLIED_EVENT } from "@/shared/lib/realtime/syncApplied";
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

        // On a counter the worker says when pulled rows are really queryable — see
        // syncApplied.ts. Not filtered by topic: the worker reports models, and mapping
        // models back to topics would mean hand-maintaining a second map that silently
        // narrows what refreshes as the schema grows, which is exactly how the worker's
        // own topic map rotted. A cycle that pulled nothing stays silent, so this only
        // fires when something really did change on this machine.
        const bridged = ensureSyncAppliedBridge();

        const offApp = onChangeSignal((sig) => {
            if (!sig.topics.some((t) => wanted.has(t))) return;
            // Screens served from the replica would read the OLD rows here: the signal
            // arrives while the worker is still pulling. Wait for `sync:applied` instead
            // (one fresh read rather than a stale one followed by a fresh one). Only when
            // that bridge exists and the status endpoint has said reads are local —
            // a browser, Vercel, or READ_MODE=live keeps refetching on this signal.
            if (bridged && getReadsGoLocal()) return;
            schedule();
        });

        const onApplied = () => schedule();
        window.addEventListener(SYNC_APPLIED_EVENT, onApplied);

        // A gap this tab sat hidden through is exactly what a remembered
        // "owed" flag would try to cover — and get wrong the moment the gap
        // held no signal at all. Reading unconditionally on return is both
        // simpler and actually safe.
        const onVisibility = () => { if (!document.hidden) run(); };
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            offApp();
            window.removeEventListener(SYNC_APPLIED_EVENT, onApplied);
            if (timer) clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [key, enabled]);
}
