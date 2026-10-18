"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

/**
 * How long a BI report waits before acting on a change signal — and, because a
 * pending read swallows further signals, the most often it will ever recompute.
 * Thirty seconds: slow enough that a busy till cannot drive the reports, fast
 * enough that a figure quoted off one of these screens is a figure from today.
 */
const BI_SETTLE_MS = 30_000;

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

    // Only the newest request may write. A report re-read for new dates while the
    // old dates' answer is still on its way used to take whichever arrived LAST —
    // a slow reply for the previous period could land over the current one, under
    // the current date boxes. The previous figures still stay on screen while the
    // new ones load (Pattern B above); they are just never overwritten by an
    // answer to a question the screen no longer asks.
    const latest = useRef(0);
    const load = useCallback(() => {
        const mine = ++latest.current;
        setLoading(true);
        axios
            .get<T>(url)
            .then((r) => {
                if (mine !== latest.current) return;
                setData(r.data);
                setError(null);
            })
            // Deliberately no toast: a toast for a failure that persists on screen
            // is told twice, and the one that fades is the one people trust.
            .catch((e) => { if (mine === latest.current) setError(extractApiError(e, "Failed to load report")); })
            .finally(() => { if (mine === latest.current) setLoading(false); });
    }, [url]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch when the query changes; the loading flag load() sets is intended
    useEffect(load, [load]);

    // Every BI report reads the books and the stock ledger, and parties for the
    // customer-shaped ones — so all four topics, for all twenty pages, from the
    // one hook they share.
    //
    // The wide settle window is the whole reason this is affordable. A BI report
    // recomputes for seconds, and the default 600 ms would put one recompute
    // behind every bill a counter rings up. `schedule` ignores a signal while a
    // read is already pending, so BI_SETTLE_MS is a rate limit as much as a
    // delay: an afternoon of selling costs one recompute per window, and the
    // reader keeps the previous figures on screen throughout (Pattern B above).
    useRealtimeTopics(["ledger", "stock", "parties", "catalogue"], load, true, undefined, BI_SETTLE_MS);

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
