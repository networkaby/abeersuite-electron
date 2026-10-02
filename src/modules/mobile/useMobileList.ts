"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { readCache, userScopedKey, writeCache } from "@/shared/lib/browser/pollCache";

type Page<T> = { items: T[]; hasMore: boolean };

/**
 * A searched, paged list for the phone app.
 *
 * The first page of each search is kept in localStorage (scoped to the user), so
 * reopening the app or repeating a search shows the last answer at once and
 * refreshes underneath — no blank screen on a weak signal. "More" pages are not
 * cached; they are a scroll away from the cached first page.
 */
export function useMobileList<T>(endpoint: string, query: string, userId: string | number) {
    const q = useDebouncedValue(query.trim(), 300);
    const key = userScopedKey(`m:${endpoint}:${q.toLowerCase()}`, userId);

    const [items, setItems] = useState<T[]>(() => readCache<Page<T>>(key)?.data.items ?? []);
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
            if (pageNo === 0) writeCache(asked, data, new Date().toISOString());
        } catch (e) {
            if (latest.current === asked) setError(extractApiError(e, "Could not load. Showing the last saved list."));
        } finally {
            if (latest.current === asked) setLoading(false);
        }
    }, [endpoint, key, q]);

    useEffect(() => {
        latest.current = key;
        const cached = readCache<Page<T>>(key);
        setItems(cached?.data.items ?? []);
        setHasMore(cached?.data.hasMore ?? false);
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
