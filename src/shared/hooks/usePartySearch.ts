"use client";

import { useEffect, useState } from "react";
import axios from "axios";

/**
 * Result row from `/api/person?lookup=…`. Shared by `PartyCombobox` and `PosScreen`.
 */
export type PartyHit = {
    id: number;
    name: string;
    phone: string | null;
    email?: string | null;
    address?: string | null;
    /** Discriminator — kept as "customer"/"company" for back-compat with POS, QuickTicket, party pickers. */
    type: "customer" | "company";
    accountId: number | null;
    linkedCompanies?: { id: number; name: string; accountId: number | null }[];
};

/**
 * Debounced lookup against `/api/person?lookup=…`. Empty / whitespace-only queries
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
    opts: {
        enabled?: boolean;
        debounceMs?: number;
        /**
         * Restrict hits to parties whose ledger sits under this AccountGroup
         * name (e.g. "Sundry Debtors" for customers, "Sundry Creditors" for
         * suppliers). Defaults to no filter — returns both sides.
         */
        group?: "Sundry Debtors" | "Sundry Creditors";
        /**
         * Widen each token's match to also cover address + email (not just
         * name + phone). Opt-in so POS / party pickers keep their strict search.
         * Used by the Front Office helper so "rosy delhi" can pair a name token
         * with an address token.
         */
        wide?: boolean;
    } = {},
): { hits: PartyHit[]; loading: boolean } {
    const { enabled = true, debounceMs = 200, group, wide = false } = opts;
    const [hits, setHits] = useState<PartyHit[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const trimmed = query.trim();
        if (!enabled || !trimmed) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setHits([]);
            setLoading(false);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            setLoading(true);
            const url = `/api/person?lookup=${encodeURIComponent(trimmed)}`
                + (group ? `&group=${encodeURIComponent(group)}` : "")
                + (wide ? "&wide=1" : "");
            axios
                .get<PartyHit[]>(url)
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
    }, [query, enabled, debounceMs, group, wide]);

    return { hits, loading };
}
