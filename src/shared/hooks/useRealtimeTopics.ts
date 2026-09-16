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
 * TWO SOURCES, NOT ONE, and they are for two different machines.
 *
 *   LOCAL (a counter, or any window reading its own replica) — `onReplicaUpdate` in
 *   syncApplied.ts. The Supabase message is only a nudge telling the sync engine to
 *   come and pull; it fires while the worker is still writing the very replica this
 *   screen reads, so acting on it means reading the old rows. The worker's own
 *   "committed and queryable" is the only honest signal here, and it is what this
 *   hook uses. A screen that is ONLY ever shown on such a window can subscribe to it
 *   directly with `useReplicaUpdate` and skip the Supabase half entirely.
 *
 *   WEB AND LIVE (a browser, Vercel, or READ_MODE=live) — the Supabase channel,
 *   filtered by topic, exactly as before. There is no replica to be behind and no
 *   worker to report, so the nudge IS the news. Unchanged on purpose.
 *
 * Both share one settle timer and one visibility listener (`createSettledReader`),
 * so a window that has both sources still does one read per burst, not two.
 */

import { useEffect, useRef } from "react";
import { onChangeSignal, getReadsGoLocal } from "@/shared/lib/realtime/appChannel";
import { ensureSyncAppliedBridge, onReplicaUpdate } from "@/shared/lib/realtime/syncApplied";
import { createSettledReader } from "@/shared/lib/realtime/settledReader";
import type { Topic } from "@/shared/lib/realtime/topics";

/**
 * The subscription underneath `useRealtimeTopics`, for callers that are not a
 * component (a module-level store such as `useNavCounts`). Same three rules: nothing
 * runs hidden, one read per burst, and on a replica-reading counter the Supabase signal
 * is ignored in favour of the worker's own `sync:applied`. Returns an unsubscribe.
 *
 * `models` optionally narrows the LOCAL half to the tables this caller reads. It does
 * not touch the Supabase half, which stays filtered by topic. Left out, any replica
 * cycle that moved anything wakes the caller — see `onReplicaUpdate` for why that is
 * the safe default.
 */
export function subscribeRealtimeTopics(
    topics: readonly Topic[],
    fn: () => void,
    models?: readonly string[],
): () => void {
    const wanted = new Set(topics);
    if (wanted.size === 0) return () => {};

    const reader = createSettledReader(fn);

    // Whether this window can hear the worker at all. Checked here because the
    // Supabase handler below has to know: with no bridge there is nothing better
    // coming, so the nudge is all there is and must not be dropped.
    const bridged = ensureSyncAppliedBridge();

    const offApp = onChangeSignal((sig) => {
        if (!sig.topics.some((t) => wanted.has(t))) return;
        // Screens served from the replica would read the OLD rows here: the signal
        // arrives while the worker is still pulling. Wait for the replica's own
        // update instead (one fresh read rather than a stale one followed by a fresh
        // one). Only when that bridge exists and the status endpoint has said reads
        // are local — a browser, Vercel, or READ_MODE=live keeps refetching here.
        if (bridged && getReadsGoLocal()) return;
        reader.schedule();
    });

    const offReplica = onReplicaUpdate(reader.schedule, models);

    return () => {
        offApp();
        offReplica();
        reader.dispose();
    };
}

/**
 * `models` narrows the LOCAL half only — see `subscribeRealtimeTopics`. Worth it on
 * a surface whose re-read is genuinely expensive (a BI report that recomputes for
 * seconds); not worth it anywhere else, because a surface that names too few tables
 * goes quietly stale and that is the fault this path exists to cure.
 */
export function useRealtimeTopics(
    topics: readonly Topic[],
    fn: () => void,
    enabled = true,
    models?: readonly string[],
) {
    const fnRef = useRef(fn);
    useEffect(() => { fnRef.current = fn; });

    // Identity-stable keys so re-rendering with a fresh array literal — which
    // every caller does — does not tear the subscription down and build it again.
    const key = [...topics].sort().join(",");
    const modelKey = models === undefined ? "" : [...models].sort().join(",");

    useEffect(() => {
        if (!enabled || key === "") return;
        return subscribeRealtimeTopics(
            key.split(",") as Topic[],
            () => fnRef.current(),
            modelKey === "" ? undefined : modelKey.split(","),
        );
    }, [key, modelKey, enabled]);
}
