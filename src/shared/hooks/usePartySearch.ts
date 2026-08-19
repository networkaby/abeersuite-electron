"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { ensurePartiesSynced, searchParties, type Party } from "@/shared/lib/parties";

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

/** A replica row carries every phone/email; the wire shape shows the primary,
 *  which is the one each list is sorted to put first. */
const toHit = (p: Party): PartyHit => ({
    id: p.id,
    name: p.name,
    phone: p.phones[0] ?? null,
    email: p.emails[0] ?? null,
    address: p.address,
    type: p.type,
    accountId: p.accountId,
    linkedCompanies: p.linkedCompanies,
});

/**
 * Debounced party lookup. Empty / whitespace-only queries short-circuit to an
 * empty result. Aborts and clears on unmount.
 *
 * LOCAL FIRST. On a counter machine the party list is replicated to IndexedDB
 * (see `partyCatalog`), and the search runs against that copy — no request, no
 * database read, an answer before the next keystroke. This used to be a round
 * trip PER CHARACTER TYPED, on the app's single most-repeated read.
 *
 * Anywhere the replica is not available — no counter bridge, IndexedDB off, or a
 * copy that has aged out — `searchParties` returns null and this falls through
 * to `/api/person?lookup=` exactly as before. That fallback is the reason the
 * till behaves identically on an unbridged machine, and why `null` from the
 * replica must never be confused with "no matches".
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

    // Warm the replica once per page load, whatever else is mounted. Deliberately
    // not awaited by the search below: a cold first keystroke simply falls back
    // to the live endpoint rather than waiting on a full list to arrive.
    useEffect(() => { void ensurePartiesSynced(); }, []);

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
            void (async () => {
                try {
                    const local = await searchParties(trimmed, { group, wide });
                    if (cancelled) return;
                    // null = no replica on this machine, NOT "no matches".
                    if (local) {
                        setHits(local.map(toHit));
                        return;
                    }
                    const url = `/api/person?lookup=${encodeURIComponent(trimmed)}`
                        + (group ? `&group=${encodeURIComponent(group)}` : "")
                        + (wide ? "&wide=1" : "");
                    const res = await axios.get<PartyHit[]>(url);
                    if (cancelled) return;
                    setHits(res.data);
                } catch {
                    if (!cancelled) setHits([]);
                } finally {
                    if (!cancelled) setLoading(false);
                }
            })();
        }, debounceMs);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, enabled, debounceMs, group, wide]);

    return { hits, loading };
}
