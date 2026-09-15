"use client";

import { useEffect, useMemo } from "react";
import {
    loadPartyList,
    usePartyStore,
    type Party,
} from "@/shared/lib/parties/partyCatalog";
import { MAX_HITS, searchPartyRows } from "@/shared/lib/parties/partySearch";
import { subscribeRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

/**
 * One party row as every picker consumes it — the primary phone and email as
 * scalars, because that is what a row DISPLAYS. What it is FOUND BY is wider
 * (every phone, every email, the address, ledger aliases, linked company names)
 * and lives on the `Party` the matcher reads; see `partySearch.partySearchText`.
 */
export type PartyHit = {
    id: number;
    name: string;
    phone: string | null;
    email?: string | null;
    address?: string | null;
    /** Kept as "customer"/"company" — every consumer already spells it that way. */
    type: "customer" | "company";
    accountId: number | null;
    linkedCompanies?: { id: number; name: string; accountId: number | null }[];
};

/** A held party row as a picker row. Exported so a caller listing the party
 *  list directly (browse-on-focus) shows exactly what a search result shows. */
export const toPartyHit = (p: Party): PartyHit => ({
    id: p.id,
    name: p.name,
    phone: p.phones[0] ?? null,
    email: p.emails[0] ?? null,
    address: p.address,
    type: p.type,
    accountId: p.accountId,
    linkedCompanies: p.linkedCompanies,
});

let subscribers = 0;
let unsubscribe: (() => void) | null = null;

/**
 * The whole party list, warmed on mount and refreshed whenever a party moves.
 *
 * `loading` is true only while the very first load is in flight. After that the
 * list always answers — from what is held, even with no network — so a picker
 * never shows a spinner mid-shift.
 *
 * One realtime subscription however many pickers are mounted: a voucher form can
 * carry three of them, and a busy branch across town should not wake each one
 * separately.
 */
export function usePartyList(): { parties: Party[]; loading: boolean } {
    const parties = usePartyStore((s) => s.parties);
    const ready = usePartyStore((s) => s.ready);

    useEffect(() => {
        void loadPartyList();
        if (subscribers++ === 0) {
            unsubscribe = subscribeRealtimeTopics(["parties"], () => { void loadPartyList(); });
        }
        return () => {
            if (--subscribers === 0) { unsubscribe?.(); unsubscribe = null; }
        };
    }, []);

    return { parties, loading: !ready };
}

/**
 * Rank the party list against what the cashier typed.
 *
 * No request, no debounce, no database read — the list is already here (see
 * `parties/partyCatalog`) and matching ~3,500 rows takes well under a
 * millisecond, so the answer is on screen before the next keystroke.
 *
 * Because the pool is the WHOLE list, the looser tiers are meaningful: a
 * run-together "medhidura" splitting into a name and a locality, a typo, or —
 * when nothing genuinely matches — the closest rows, flagged in `guessIds` so the
 * dropdown can colour them as suggestions rather than answers. Over the partial
 * pools this used to search, all three were noise dressed up as results.
 *
 * `enabled` lets a caller switch the search off without unmounting, e.g. while a
 * selection is settled and the input should not refire.
 */
export function usePartySearch(
    query: string,
    opts: {
        enabled?: boolean;
        /**
         * Restrict hits to parties whose ledger sits under this AccountGroup name
         * ("Sundry Debtors" for customers, "Sundry Creditors" for suppliers).
         * Defaults to no filter — returns both sides.
         */
        group?: "Sundry Debtors" | "Sundry Creditors";
    } = {},
): { hits: PartyHit[]; loading: boolean; guessIds: Set<string> } {
    const { enabled = true, group } = opts;
    const { parties, loading } = usePartyList();
    const trimmed = query.trim();

    const { hits, guessIds } = useMemo(() => {
        if (!enabled || !trimmed) return { hits: [] as PartyHit[], guessIds: new Set<string>() };
        const ranked = searchPartyRows(parties, trimmed, { group, rows: MAX_HITS });
        return {
            hits: ranked.rows.map(toPartyHit),
            guessIds: ranked.guessIds as Set<string>,
        };
    }, [parties, trimmed, enabled, group]);

    return { hits, loading, guessIds };
}
