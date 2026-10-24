"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { MOBILE_FRESH_MS } from "@/shared/lib/constants/polling";
import { loadAnswer, mobileKey, offlineNote } from "../lib/mobileCache";
import { useValueChange } from "@/shared/hooks/useValueChange";

/** A server-paged list API's reply. `more` is the query to send for the next page
 *  (a cursor, and whatever else must carry over — a running balance). */
type Page<T> = { items: T[]; hasMore: boolean; more?: Record<string, string> | null };

/**
 * A searched, server-paged list for the phone app — what a list too big to keep
 * on the device needs (the Day Book). Searches that can run over a catalogue the
 * device already holds (products, parties) do not use this; they filter locally.
 *
 * The first page goes through the saved-answer step (`loadAnswer`, `?since=`
 * aware), so reopening a day costs nothing while it is fresh and one indexed
 * probe after that if nobody has posted since. Further pages are asked for on
 * demand and not saved.
 *
 * `params` are extra query values (the Day Book's date); a change starts the list
 * over, exactly like a new search. `freshMs: 0` asks (with `?since=`) on every
 * open — for a list whose whole point is "has it landed yet?".
 */
export function useMobileList<T>(
    endpoint: string,
    query: string,
    userId: string | number,
    params: Record<string, string> = {},
    opts: { freshMs?: number } = {},
) {
    const freshMs = opts.freshMs ?? MOBILE_FRESH_MS;
    const q = useDebouncedValue(query.trim(), 300);
    const extra = new URLSearchParams(params).toString();
    const key = mobileKey(`${endpoint}:${q.toLowerCase()}${extra ? `?${extra}` : ""}`, userId);
    const firstUrl = `${endpoint}?${new URLSearchParams({ ...params, q })}`;

    const [items, setItems] = useState<T[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [more, setMore] = useState<Record<string, string> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const latest = useRef(key);
    const shownAt = useRef<number | null>(null);

    const readFirst = useCallback((force: boolean) => {
        const asked = key;
        return loadAnswer<Page<T>>(key, firstUrl, { freshMs, since: true, force }, (page, at) => {
            if (latest.current !== asked) return;
            shownAt.current = at;
            setItems(page.items);
            setHasMore(page.hasMore);
            setMore(page.more ?? null);
        })
            .catch((e) => {
                if (latest.current === asked) setError(offlineNote(extractApiError(e, "Could not load"), shownAt.current));
            })
            .finally(() => {
                if (latest.current === asked) setLoading(false);
            });
    }, [key, firstUrl, freshMs]);
    /** Refresh: the spinner and a clean error first, then the read. */
    const loadFirst = useCallback(async (force: boolean) => {
        setLoading(true);
        setError(null);
        await readFirst(force);
    }, [readFirst]);

    const loadMore = useCallback(async () => {
        if (!more) return;
        const asked = key;
        setLoading(true);
        setError(null);
        try {
            const { data } = await axios.get<Page<T>>(`${firstUrl}&${new URLSearchParams(more)}`);
            if (latest.current !== asked) return;
            setItems((was) => [...was, ...data.items]);
            setHasMore(data.hasMore);
            setMore(data.more ?? null);
        } catch (e) {
            if (latest.current === asked) setError(extractApiError(e, "Could not load more."));
        } finally {
            if (latest.current === asked) setLoading(false);
        }
    }, [key, firstUrl, more]);

    // Another day's rows must not sit under this day's date while it loads;
    // a saved answer for this one comes back from the device in milliseconds.
    // Cleared while rendering, so the old rows never paint under the new key.
    if (useValueChange(key)) {
        setItems([]);
        setHasMore(false);
        setMore(null);
        setLoading(true);
        setError(null);
    }
    useEffect(() => {
        latest.current = key;
        shownAt.current = null;
        void readFirst(false);
    }, [key, readFirst]);

    return {
        items,
        empty: items.length === 0,
        hasMore,
        loading,
        error,
        loadMore: () => void loadMore(),
        refresh: () => void loadFirst(true),
    };
}
