"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

/** Shared fetch loop for BI report pages — GET the url, hold data + loading. */
export function useBiQuery<T>(url: string) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<T>(url)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load report"))
            .finally(() => setLoading(false));
    }, [url]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    return { data, loading, reload: load };
}
