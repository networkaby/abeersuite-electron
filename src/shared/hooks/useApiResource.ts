"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";

/**
 * One-shot GET hook for the common `useEffect(() => { fetch; setState })` pattern.
 *
 * - Fires on mount and whenever `url` changes.
 * - Pass `null` to disable (e.g. when a parent id isn't ready yet).
 * - `reload()` re-fires the same URL on demand.
 *
 * Returns `{ data, loading, error, reload }`. The `data` type is whatever shape
 * the server returns; callers supply the type parameter.
 *
 * Usage:
 *   const { data: branches = [], loading, reload } = useApiResource<Branch[]>("/api/branches");
 */
export function useApiResource<T>(
    url: string | null,
    opts: { initial?: T } = {},
): {
    data: T | undefined;
    loading: boolean;
    error: string | null;
    reload: () => void;
} {
    const [data, setData] = useState<T | undefined>(opts.initial);
    const [loading, setLoading] = useState(url !== null);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (url === null) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        axios
            .get<T>(url)
            .then((res) => {
                if (cancelled) return;
                setData(res.data);
            })
            .catch((e) => {
                if (cancelled) return;
                const msg =
                    axios.isAxiosError(e) && typeof e.response?.data?.error === "string"
                        ? e.response.data.error
                        : "Failed to load";
                setError(msg);
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [url, tick]);

    const reload = useCallback(() => setTick((n) => n + 1), []);

    return { data, loading, error, reload };
}
