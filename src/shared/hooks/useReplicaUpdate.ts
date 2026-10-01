"use client";

/**
 * useReplicaUpdate — re-read when THIS machine's replica has actually changed.
 *
 * The purely local subscription. A counter reads from its own replica, and the
 * chain that fills it is:
 *
 *   Supabase realtime  →  "sync engine, come and pull"      ← a nudge, not data
 *   sync-once.js       →  pulls, commits, then prints       __SYNC_APPLIED__
 *   index.js (worker)  →  sends it over IPC                  { type: "applied" }
 *   syncManager.ts     →  forwards it to every window        "sync:applied"
 *   syncApplied.ts     →  window event carrying { rows, models }
 *
 * Only the LAST link means the rows are queryable. This hook listens to that and
 * to nothing else, so a screen using it can never read ahead of its own replica.
 *
 * Use this when a surface is only ever shown on a counter or an office window that
 * reads local. When the same screen also runs on the web or against live — where
 * there is no replica and no worker — use `useRealtimeTopics`, which keeps the
 * Supabase channel for exactly that case and uses this one underneath when a
 * replica is present.
 *
 * `models` is optional and defaults to "any cycle that moved anything". That
 * default is deliberate: a screen that names too few tables goes quietly stale,
 * which is the very fault this path exists to cure, so narrowing is opt-in and
 * only worth it where the extra reads are shown to cost something. Names are the
 * Prisma model names — the same ones in `syncRegistry.generated.ts`.
 *
 * `fn` may change identity between renders — the latest one is always used and the
 * subscription is not rebuilt for it, so callers need not memoise.
 */

import { useEffect, useRef } from "react";
import { onReplicaUpdate } from "@/shared/lib/realtime/syncApplied";
import { createSettledReader } from "@/shared/lib/realtime/settledReader";

/**
 * The subscription underneath the hook, for callers that are not a component (a
 * module-level store such as `useNavCounts`). Returns an unsubscribe.
 */
export function subscribeReplicaUpdate(
    fn: () => void,
    models?: readonly string[],
): () => void {
    const reader = createSettledReader(fn);
    const off = onReplicaUpdate(reader.schedule, models);
    return () => {
        off();
        reader.dispose();
    };
}

export function useReplicaUpdate(
    fn: () => void,
    models?: readonly string[],
    enabled = true,
) {
    const fnRef = useRef(fn);
    useEffect(() => { fnRef.current = fn; });

    // Identity-stable key so re-rendering with a fresh array literal — which every
    // caller does — does not tear the subscription down and build it again.
    const key = models === undefined ? "" : [...models].sort().join(",");

    useEffect(() => {
        if (!enabled) return;
        return subscribeReplicaUpdate(
            () => fnRef.current(),
            key === "" ? undefined : (key.split(",") as string[]),
        );
    }, [key, enabled]);
}
