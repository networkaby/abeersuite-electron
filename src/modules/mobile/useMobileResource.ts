"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { mobileKey, readMobileCache, writeMobileCache } from "./mobileCache";

/**
 * One GET for a phone screen, with the last answer kept on the phone: the saved
 * copy shows at once and the fresh one replaces it, so a weak signal never shows
 * a blank screen. `url = null` waits (nothing to ask yet).
 *
 * The saved copy is read in an effect, never in the first render — the server has
 * no localStorage, so using it there would not match the server's HTML.
 */
export function useMobileResource<T>(url: string | null, cacheName: string, userId: string | number) {
    const key = mobileKey(cacheName, userId);
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const latest = useRef(key);

    const load = useCallback(async () => {
        if (!url) return;
        const asked = key;
        setLoading(true);
        setError(null);
        try {
            const { data: fresh } = await axios.get<T>(url);
            if (latest.current !== asked) return;
            setData(fresh);
            writeMobileCache(asked, fresh, userId);
        } catch (e) {
            if (latest.current === asked) setError(extractApiError(e, "Could not load. Showing the last saved copy."));
        } finally {
            if (latest.current === asked) setLoading(false);
        }
    }, [url, key, userId]);

    useEffect(() => {
        latest.current = key;
        const cached = readMobileCache<T>(key);
        if (cached) setData(cached);
        void load();
    }, [key, load]);

    return { data, loading, error, refresh: () => void load() };
}
