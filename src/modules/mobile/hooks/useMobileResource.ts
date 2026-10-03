"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { MOBILE_FRESH_MS } from "@/shared/lib/constants/polling";
import { loadAnswer, mobileKey, offlineNote } from "../lib/mobileCache";

/**
 * One GET for a phone screen, through the saved-answer step (`loadAnswer`): the
 * last answer shows at once, a fresh one is not asked for again, and a stale one
 * is re-asked with `?since=` when the endpoint supports it (`since: true`).
 * `refresh()` always asks. `url = null` waits.
 *
 * When the server cannot be reached, `error` says how old the figures on screen
 * are ("Showing figures from 10:42") — they stay up.
 *
 * The saved copy is read in an effect, never in the first render — the server has
 * no IndexedDB, so using it there would not match the server's HTML.
 */
export function useMobileResource<T>(
    url: string | null,
    cacheName: string,
    userId: string | number,
    opts: { freshMs?: number; since?: boolean } = {},
) {
    const key = mobileKey(cacheName, userId);
    const freshMs = opts.freshMs ?? MOBILE_FRESH_MS;
    const since = opts.since ?? false;
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const latest = useRef(key);
    const shownAt = useRef<number | null>(null);

    const load = useCallback(async (force: boolean) => {
        if (!url) return;
        const asked = key;
        setLoading(true);
        setError(null);
        try {
            await loadAnswer<T>(key, url, { freshMs, since, force }, (d, at) => {
                if (latest.current !== asked) return;
                setData(d);
                shownAt.current = at;
            });
        } catch (e) {
            if (latest.current === asked) setError(offlineNote(extractApiError(e, "Could not reach the server."), shownAt.current));
        } finally {
            if (latest.current === asked) setLoading(false);
        }
    }, [url, key, freshMs, since]);

    useEffect(() => {
        latest.current = key;
        shownAt.current = null;
        void load(false);
    }, [key, load]);

    return { data, loading, error, refresh: () => void load(true) };
}
