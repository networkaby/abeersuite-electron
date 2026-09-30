"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import type { Topic } from "@/shared/lib/realtime/topics";
import { useRealtimeTopics } from "./useRealtimeTopics";

/**
 * One-shot GET hook for the common `useEffect(() => { fetch; setState })` pattern.
 *
 * - Fires on mount and whenever `url` changes.
 * - Pass `null` to disable (e.g. when a parent id isn't ready yet).
 * - `reload()` re-fires the same URL on demand.
 *
 * Pattern B lives here. `reload()` used to set `loading` true, and callers gate
 * their body on `!loading`, so every manual Refresh, date change and post-save
 * refetch unmounted a perfectly readable screen and replaced it with a spinner —
 * losing scroll position, expanded groups and half-typed cells with it.
 *
 * The two cases are now told apart, because they are genuinely different:
 *
 *   `loading`    — there is nothing on screen yet. A spinner is the honest answer.
 *   `refreshing` — the same URL is being re-fetched over data the user is reading.
 *                  Keep the data. Show it in the toolbar, not over the table.
 *
 * A CHANGE of `url` is the first case, not the second: the data in hand belongs
 * to a different record, so it is dropped rather than shown under the new
 * heading. Holding one account's ledger under another account's name would be a
 * worse bug than the flicker.
 *
 * A reply for a URL the screen has since moved away from is thrown away, so a
 * slow answer for the old filters can never land over the new ones.
 *
 * `topics` re-reads on the matching realtime signal (see useRealtimeTopics) —
 * as a refresh, so the figures stay on screen while the new ones come in.
 *
 * `keepPrevious` treats a URL change as a refresh too: the old figures stay on
 * screen until the new ones land. Only for a screen where the URL is a filter on
 * the SAME thing (a report's dates) — never where it names a different record.
 *
 * `reload()` returns the payload that read brought back — for a caller that must
 * act on the fresh data (patch a list row's name after a save). It settles with
 * `undefined` when the read fails or is overtaken by a change of URL.
 *
 * Usage:
 *   const { data: branches = [], loading, refreshing, error, reload } =
 *       useApiResource<Branch[]>("/api/branches");
 *
 *   const { data, loading } = useApiResource<TB>(`/api/…?from=${from}`, { topics: ["ledger"] });
 *
 *   {loading ? <Skeleton /> : <List rows={branches} />}
 *   <Button onClick={reload} disabled={refreshing}>Refresh</Button>
 */
export function useApiResource<T>(
    url: string | null,
    opts: { initial?: T; topics?: readonly Topic[]; keepPrevious?: boolean } = {},
): {
    data: T | undefined;
    /** First load for this URL — nothing to show yet. */
    loading: boolean;
    /** Re-fetch of the same URL over data already on screen. */
    refreshing: boolean;
    error: string | null;
    reload: () => Promise<T | undefined>;
} {
    const [data, setData] = useState<T | undefined>(opts.initial);
    const [loading, setLoading] = useState(url !== null);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    // Which URL the data in state belongs to, so a URL change can be told from a
    // reload of the same one.
    const loadedUrl = useRef<string | null>(null);
    // reload() callers waiting for the read their call started.
    const waiting = useRef<((value: T | undefined) => void)[]>([]);

    useEffect(() => {
        if (url === null) {
            setLoading(false);
            setRefreshing(false);
            return;
        }

        let cancelled = false;
        const mine = waiting.current;
        waiting.current = [];
        const settle = (value: T | undefined) => { for (const resolve of mine) resolve(value); };
        const sameUrl = loadedUrl.current === url;
        const keepVisible = (sameUrl || opts.keepPrevious === true) && data !== undefined;

        if (keepVisible) setRefreshing(true);
        else {
            setLoading(true);
            // Data from a different URL must not sit under the new heading.
            if (!sameUrl && loadedUrl.current !== null) setData(opts.initial);
        }
        setError(null);

        axios
            .get<T>(url)
            .then((res) => {
                if (cancelled) return;
                setData(res.data);
                loadedUrl.current = url;
                settle(res.data);
            })
            .catch((e) => {
                if (cancelled) return;
                setError(extractApiError(e, "Failed to load"));
                settle(undefined);
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
                setRefreshing(false);
            });

        return () => {
            cancelled = true;
            settle(undefined);
        };
        // `data` is read only to decide whether anything is worth keeping on
        // screen; re-running on every payload would loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url, tick]);

    const reload = useCallback(() => new Promise<T | undefined>((resolve) => {
        waiting.current.push(resolve);
        setTick((n) => n + 1);
    }), []);
    useRealtimeTopics(opts.topics ?? [], reload, url !== null);

    return { data, loading, refreshing, error, reload };
}
