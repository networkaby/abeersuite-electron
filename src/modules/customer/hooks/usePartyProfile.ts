"use client";

// The open party on the Contacts screens (All / Person / Companies): its detail and
// its statement, each tied to the party it was read for.
//
// These three pages used to read both by hand, with nothing to say which party a
// reply belonged to — click A, then B, and A's slower answer could land last and
// sit under B's name: the wrong balance quoted, the wrong bills settled. Built on
// useApiResource, a reply for a party (or a period) the screen has already left is
// dropped, and one party's data is never shown under another's heading.

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import type { CustomerTransactions } from "@/modules/customer/components/TransactionsTable";

export type PartyKind = "person" | "company";

const API_BASE: Record<PartyKind, string> = { person: "/api/person", company: "/api/companies" };

/** The selected party's profile. `id` null = nothing open. */
export function usePartyDetail<T>(kind: PartyKind | null, id: number | null, errorMessage: string) {
    const url = kind && id != null ? `${API_BASE[kind]}/${id}` : null;
    const { data, loading, error, reload } = useApiResource<T>(url);
    useEffect(() => { if (error) toast.error(errorMessage); }, [error, errorMessage]);
    return {
        /** Null while nothing is open or while another party's profile is still held. */
        detail: url ? (data ?? null) : null,
        loading: url !== null && loading,
        /** Re-read; resolves with the fresh profile (undefined on failure / party change). */
        reload,
    };
}

/**
 * The selected party's statement — for a period, or its whole history when none is
 * given (the All Customers page). It is read only while its tab is on
 * screen: the books moving while it is off screen only mark it stale, and it is
 * re-read (quietly — the rows stay up) the moment the tab comes back (AGENTS.md §7:
 * no fetch for a tab nobody is looking at, no blank flicker).
 */
export function usePartyTransactions(
    kind: PartyKind | null,
    id: number | null,
    period: { from: string; to: string } | null,
    onScreen: boolean,
) {
    const range = period ? `?from=${period.from}&to=${period.to}` : "";
    const url = kind && id != null ? `${API_BASE[kind]}/${id}/transactions${range}` : null;
    const { data, loading, refreshing, error, reload } = useApiResource<CustomerTransactions>(url);
    // A failed first read is worth a toast; a quiet re-read under rows that are
    // already there is not something the user did.
    useEffect(() => { if (error && !data) toast.error("Failed to load transactions"); }, [error, data]);

    // A receipt made at Head Office reaches a till's replica a moment later; on a
    // counter the signal fires only after the sync worker has committed the rows,
    // on the web it is the Supabase channel. On screen → re-read in place; off
    // screen → remember, and re-read when the tab is opened.
    const stale = useRef(false);
    useRealtimeTopics(["ledger"], () => {
        if (onScreen) void reload();
        else stale.current = true;
    }, url !== null);
    useEffect(() => {
        if (onScreen && stale.current) {
            stale.current = false;
            void reload();
        }
    }, [onScreen, reload]);

    return {
        transactions: url ? (data ?? null) : null,
        /** A read is in flight — first load, new period or new party (no rows yet). */
        loading: url !== null && loading,
        refreshing,
        reload,
        /** Something changed the books from inside the profile — re-read on the way in. */
        markStale: () => { stale.current = true; },
    };
}
