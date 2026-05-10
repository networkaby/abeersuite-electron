"use client";

import { useEffect, useState } from "react";
import axios from "axios";

/**
 * Result row from `/api/people?lookup=…`. Shared by `PartyCombobox` and `PosScreen`.
 */
export type PartyHit = {
    id: number;
    name: string;
    phone: string | null;
    /** Discriminator — kept as "customer"/"company" for back-compat with POS, QuickTicket, party pickers. */
    type: "customer" | "company";
    accountId: number | null;
    linkedCompanies?: { id: number; name: string; accountId: number | null }[];
};

/**
 * Debounced lookup against `/api/people?lookup=…`. Empty / whitespace-only queries
 * short-circuit to an empty result. Aborts and clears on unmount.
 *
 * `enabled` lets callers turn the search off without unmounting (e.g. while a
 * selection is settled and the input should not refire).
 *
 * Usage:
 *   const { hits, loading } = usePartySearch(query, { enabled: open });
 */
export function usePartySearch(
    query: string,
    opts: { enabled?: boolean; debounceMs?: number } = {},
): { hits: PartyHit[]; loading: boolean } {
    const { enabled = true, debounceMs = 200 } = opts;
    const [hits, setHits] = useState<PartyHit[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const trimmed = query.trim();
        if (!enabled || !trimmed) {
            setHits([]);
            setLoading(false);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            setLoading(true);
            axios
                .get<PartyHit[]>(`/api/people?lookup=${encodeURIComponent(trimmed)}`)
                .then((res) => {
                    if (cancelled) return;
                    setHits(res.data);
                })
                .catch(() => {
                    if (cancelled) return;
                    setHits([]);
                })
                .finally(() => {
                    if (cancelled) return;
                    setLoading(false);
                });
        }, debounceMs);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, enabled, debounceMs]);

    return { hits, loading };
}
