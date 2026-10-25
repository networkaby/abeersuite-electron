"use client";

/**
 * A small, rarely-changing list, answered from this browser's saved copy
 * (localStorage, via pollCache) and fetched only when that copy is older than
 * `maxAgeMs`, or on `refresh()`. Another tab's fresh copy is adopted without a
 * fetch. Shared by usePositionPicker and useBranchOptions — each says what to
 * fetch and under which key, this hook does the rest.
 *
 * `key` null means "not yet known" (e.g. the user id before the session loads):
 * nothing is read or fetched until it arrives.
 *
 * `fetcher` must be stable — define it at module level, not inside a component.
 */

import { useCallback, useEffect, useState } from "react";
import { readCache, subscribeToCache, writeCache, type CachedEntry } from "@/shared/lib/browser/pollCache";

const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

export function useBrowserCached<T>(
    key: string | null,
    fetcher: () => Promise<CachedEntry<T>>,
    empty: T,
    maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): {
    data: T;
    /** False only until the first cache read or fetch settles. */
    ready: boolean;
    /** Force a re-read, bypassing the cached copy. */
    refresh: () => void;
} {
    // Seeded in an effect, never during render: reading localStorage while
    // rendering would make the client's first pass disagree with the server's
    // empty one, which is a hydration mismatch.
    const [data, setData] = useState<T>(empty);
    const [ready, setReady] = useState(false);

    const load = useCallback(
        (force: boolean) => {
            if (!key) return;
            if (!force) {
                const hit = readCache<T>(key);
                if (hit && Date.now() - new Date(hit.computedAt).getTime() < maxAgeMs) {
                    setData(hit.data);
                    setReady(true);
                    return;   // the saving: no request leaves the browser
                }
            }
            fetcher()
                .then((next) => {
                    setData(next.data);
                    writeCache(key, next.data, next.computedAt);
                })
                // Keep whatever is already shown — a stale list still works.
                .catch(() => {})
                .finally(() => setReady(true));
        },
        [key, fetcher, maxAgeMs],
    );

    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopts this browser's saved copy after hydration (see `data` above); reading it during render would mismatch the server's empty pass
    useEffect(() => { load(false); }, [load]);

    // Another tab just fetched: adopt its copy rather than fetching again here.
    useEffect(() => {
        if (!key) return;
        return subscribeToCache<T>(key, (entry) => setData(entry.data));
    }, [key]);

    return { data, ready, refresh: useCallback(() => load(true), [load]) };
}
