"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { mobileKey, readMobileCache, writeMobileCache } from "./mobileCache";

type Page<T> = { items: T[]; hasMore: boolean };

/**
 * A searched, paged list for the phone app.
 *
 * The first page of each search is kept in localStorage (scoped to the user), so
 * reopening the app or repeating a search shows the last answer at once and
 * refreshes underneath — no blank screen on a weak signal. "More" pages are not
 * cached; they are a scroll away from the cached first page.
 *
 * The saved copy is read in an effect, never in the first render: the server has
 * no localStorage, so a first render that used it would not match the server's
 * HTML (a hydration error).
 */
export function useMobileList<T>(endpoint: string, query: string, userId: string | number) {
    const q = useDebouncedValue(query.trim(), 300);
    const key = mobileKey(`${endpoint}:${q.toLowerCase()}`, userId);

    const [items, setItems] = useState<T[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const latest = useRef(key);

    const load = useCallback(async (pageNo: number) => {
        const asked = key;
        setLoading(true);
        setError(null);
        try {
            const { data } = await axios.get<Page<T>>(endpoint, { params: { q, page: pageNo } });
            if (latest.current !== asked) return;
            setItems((was) => (pageNo === 0 ? data.items : [...was, ...data.items]));
            setHasMore(data.hasMore);
            setPage(pageNo);
            if (pageNo === 0) writeMobileCache(asked, data, userId);
        } catch (e) {
            if (latest.current === asked) setError(extractApiError(e, "Could not load. Showing the last saved list."));
        } finally {
            if (latest.current === asked) setLoading(false);
        }
    }, [endpoint, key, q, userId]);

    useEffect(() => {
        latest.current = key;
        // A saved answer for this search shows at once; without one, the previous
        // search's rows stay up until the new ones land rather than blanking.
        const cached = readMobileCache<Page<T>>(key);
        if (cached) {
            setItems(cached.items);
            setHasMore(cached.hasMore);
        }
        void load(0);
    }, [key, load]);

    return {
        items,
        hasMore,
        loading,
        error,
        loadMore: () => void load(page + 1),
        refresh: () => void load(0),
    };
}
