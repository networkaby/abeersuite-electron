"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";

/**
 * Shared fetch loop for the twenty BI report pages.
 *
 * This hook is where Patterns A and B are fixed for the whole BI section at once,
 * which is why the fix lives here rather than in twenty pages.
 *
 * Pattern A — a failed load used to `toast.error("Failed to load report")` and
 * leave `data` at null. Every page renders its body only when `data` is truthy,
 * so four seconds after the toast faded the user had a header, a filter bar, and
 * nothing else — indistinguishable from a period with no sales, and with no way
 * to retry. The error is now kept and rendered by `status`.
 *
 * Pattern B — the pages gated their body on `!loading`, so pressing Refresh or
 * changing a date threw the whole report away and replaced it with a centred
 * spinner: KPI cards, charts, scroll position and expanded drill-downs all gone,
 * then back. `data` survives a reload here, and the pages now gate on `data`
 * alone, so a refresh updates the figures under the reader instead of removing
 * them.
 *
 * Usage — the whole of it:
 *
 *     const { data, status, reload } = useBiQuery<Report>(url);
 *     …
 *     {status}
 *     {data && <TheReport … />}
 */
export function useBiQuery<T>(url: string): {
    /** Last successful payload. Survives a failed or in-flight reload. */
    data: T | null;
    /** A request is in flight — including a background one over readable data. */
    loading: boolean;
    /** Message from the last failed request, cleared by the next success. */
    error: string | null;
    reload: () => void;
    /**
     * Ready-made spinner / error / stale-data banner. Render it where the old
     * `{loading && <spinner/>}` block sat. Null when there is nothing to say.
     */
    status: React.ReactNode;
} {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        axios
            .get<T>(url)
            .then((r) => {
                setData(r.data);
                setError(null);
            })
            // Deliberately no toast: a toast for a failure that persists on screen
            // is told twice, and the one that fades is the one people trust.
            .catch((e) => setError(extractApiError(e, "Failed to load report")))
            .finally(() => setLoading(false));
    }, [url]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    const status = (
        <QueryStateBlock
            loading={loading}
            error={error}
            hasData={data !== null}
            onRetry={load}
            loadingLabel="Loading report…"
        />
    );

    return { data, loading, error, reload: load, status };
}
