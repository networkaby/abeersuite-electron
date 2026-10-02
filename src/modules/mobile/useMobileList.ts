"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { mobileKey, readMobileCache, writeMobileCache } from "./mobileCache";

/** A list API's reply. `next`, when the API pages by cursor (the Day Book), is
 *  handed back as `?cursor=` for the next page; otherwise `?page=` counts up. */
type Page<T> = { items: T[]; hasMore: boolean; next?: number | null };

/**
 * A searched, paged list for the phone app.
 *
 * The first page of each search is kept in localStorage (scoped to the user), so
 * reopening the app or repeating a search shows the last answer at once and
 * refreshes underneath — no blank screen on a weak signal. "More" pages are not
 * cached; they are a scroll away from the cached first page.
 *
 * `params` are extra query values (the Day Book's date); a change starts the list
 * over, exactly like a new search.
 *
 * The saved copy is read in an effect, never in the first render: the server has
 * no localStorage, so a first render that used it would not match the server's
 * HTML (a hydration error).
 */
export function useMobileList<T>(
    endpoint: string,
    query: string,
    userId: string | number,
    params: Record<string, string> = {},
) {
    const q = useDebouncedValue(query.trim(), 300);
    const extra = new URLSearchParams(params).toString();
    const key = mobileKey(`${endpoint}:${q.toLowerCase()}${extra ? `?${extra}` : ""}`, userId);

    const [items, setItems] = useState<T[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(0);
    const [next, setNext] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const latest = useRef(key);

    const load = useCallback(async (pageNo: number, cursor: number | null) => {
        const asked = key;
        setLoading(true);
        setError(null);
        try {
            const { data } = await axios.get<Page<T>>(
                `${endpoint}?${extra ? `${extra}&` : ""}${new URLSearchParams({
                    q,
                    page: String(pageNo),
                    ...(cursor != null ? { cursor: String(cursor) } : {}),
                })}`,
            );
            if (latest.current !== asked) return;
            setItems((was) => (pageNo === 0 ? data.items : [...was, ...data.items]));
            setHasMore(data.hasMore);
            setNext(data.next ?? null);
            setPage(pageNo);
            if (pageNo === 0) writeMobileCache(asked, data, userId);
        } catch (e) {
            if (latest.current === asked) setError(extractApiError(e, "Could not load. Showing the last saved list."));
        } finally {
            if (latest.current === asked) setLoading(false);
        }
    }, [endpoint, extra, key, q, userId]);

    useEffect(() => {
        latest.current = key;
        // A saved answer for this search shows at once; without one, the previous
        // search's rows stay up until the new ones land rather than blanking.
        const cached = readMobileCache<Page<T>>(key);
        if (cached) {
            setItems(cached.items);
            setHasMore(cached.hasMore);
            setNext(cached.next ?? null);
        }
        void load(0, null);
    }, [key, load]);

    return {
        items,
        empty: items.length === 0,
        hasMore,
        loading,
        error,
        loadMore: () => void load(page + 1, next),
        refresh: () => void load(0, null),
    };
}
