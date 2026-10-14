"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { browseParties, type Party, type PartyType } from "@/shared/lib/parties";
import { usePartyList } from "@/shared/hooks/usePartySearch";
import type { BrowseCursor } from "@/shared/lib/parties/browsePage";
import { BROWSE_PAGE_SIZE } from "@/shared/lib/constants/paging";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import type { PartySort } from "@/modules/customer/lib/partySort";

/**
 * Grow-on-scroll list fetching, shared by the Contacts (Person) and Companies
 * browse pages — the same feature over two tables, so one hook drives both
 * rather than each page reinventing pagination and cache feed-back on its own.
 *
 * Server-side pagination covers Name-ascending only (see `browsePage.ts` for
 * why). Any other sort — Name descending, Amount either way — asks for one
 * unbounded page and stops there, exactly like the pages did before this hook
 * existed; `loadMore` is simply inert in that case.
 *
 * It also paints from the party list held in memory (`partyCatalog.ts`) while
 * the first page is in flight, when the caller supplies `cachePlaceholder` — see
 * that option for the two deliberate limits on when that happens.
 */

/** The subset of a browse row this hook needs — both `CustomerListItem` and
 *  `CompanyListItem` already carry it (see /api/person and /api/companies). */
export interface BrowseListRow {
    id: number;
    name: string;
    isActive: boolean;
    address?: string | null;
    phones?: { phone: string }[];
    emails?: { email: string }[];
    aliases?: string[];
    accountGroup?: string | null;
    accountGroupType?: Party["accountGroupType"];
    account: { id: number } | null;
    /** True on a row painted from the cache while the real page is still in
     *  flight. The cache holds identity, never ledger balance — so a row
     *  carrying this must render its money column as pending, NOT as a number.
     *  Cleared implicitly: the live page replaces these rows outright. */
    fromCache?: boolean;
}


const NO_ROWS: never[] = [];

interface BrowseResponse<T> {
    items: T[];
    nextCursor: BrowseCursor | null;
}

export function usePartyBrowseList<T extends BrowseListRow>(opts: {
    type: PartyType;
    apiPath: string;
    search: string;
    sort: PartySort;
    hideCreditors: boolean;
    includeInactive: boolean;
    errorMessage: string;
    /**
     * Turn a cached party into one of this page's rows, to paint while the real
     * first page is still in flight. Omit to keep the list live-only.
     *
     * The row it returns MUST mark itself `fromCache: true` and leave anything
     * the cache cannot know — a ledger balance above all — visibly pending
     * rather than defaulted to a number.
     *
     * Only ever used for the FIRST page of an UNSEARCHED list, which is exactly
     * the "opening the panel shouldn't be blank" case. Not for a search (a
     * partial cache would read as "these are all the matches" on a directory
     * whose job is to be complete), and not for later pages (those grow from a
     * server cursor the cache has no equivalent of).
     */
    cachePlaceholder?: (p: Party) => T;
    /** False = ask for nothing and hold no rows — a list the screen is not
     *  showing right now (the other kind's matches on a one-kind page with an
     *  empty search box). Default true. */
    enabled?: boolean;
}): {
    items: T[];
    loadingMore: boolean;
    /** Another page is waiting on the server (Name-ascending only). */
    hasMore: boolean;
    loadMore: () => void;
    /** Reload from page one with the current filters — after a create, delete,
     *  or reactivate changes which rows belong in the list at all. */
    refresh: () => Promise<void>;
    /** Patch one already-loaded row in place — for an edit that changes how a
     *  row displays (e.g. a renamed party) without changing which rows belong
     *  in the list, so it doesn't need a full reload. */
    updateItem: (id: number, patch: Partial<T>) => void;
} {
    const { type, apiPath, search, sort, hideCreditors, includeInactive, errorMessage, cachePlaceholder, enabled = true } = opts;
    const [items, setItems] = useState<T[]>([]);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const cursorRef = useRef<BrowseCursor | null>(null);
    // Bumped on every fresh fetch so a slow response from a since-abandoned
    // filter combination can't land after a newer one already has.
    const genRef = useRef(0);

    const paginated = sort.key === "name" && sort.dir === "asc";
    const { parties } = usePartyList();

    // Which question the list is currently asking. Compared against the question
    // the newest ANSWER belongs to, so "still loading" can be told apart from
    // "loaded, and the answer is none" — see `shown` below.
    const filterKey = `${apiPath}|${search}|${hideCreditors}|${includeInactive}|${paginated}`;
    const [landedKey, setLandedKey] = useState<string | null>(null);

    const fetchPage = useCallback((cursor: BrowseCursor | null) => {
        const gen = ++genRef.current;
        const params: Record<string, string> = {
            ...(search ? { q: search } : {}),
            ...(hideCreditors ? { hideCreditors: "1" } : {}),
            // Both party browse lists draw the broken-chain mark, so both ask for
            // `toLink`. It is opt-in on the route because the till's cache and the
            // voucher pickers read the same endpoint and never draw it.
            withLinkHint: "1",
            ...(includeInactive ? { includeInactive: "1" } : {}),
            ...(paginated ? { paginate: "1" } : {}),
            ...(paginated && cursor ? { cursorName: cursor.name, cursorId: String(cursor.id) } : {}),
        };
        // The envelope is opt-in server-side (every other caller of these routes
        // still gets a plain array) — so only the paginated branch gets one back;
        // the unbounded (Amount-sort) branch is read as a single, final page.
        return axios.get<BrowseResponse<T> | T[]>(apiPath, { params })
            .then((res) => {
                if (genRef.current !== gen) return; // superseded by a newer request
                const data = Array.isArray(res.data) ? { items: res.data, nextCursor: null } : res.data;
                cursorRef.current = data.nextCursor;
                setHasMore(data.nextCursor !== null);
                setLandedKey(filterKey);
                setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
            })
            .catch(() => { if (genRef.current === gen) toast.error(errorMessage); });
    }, [apiPath, search, hideCreditors, includeInactive, paginated, errorMessage, filterKey]);

    // Any filter, sort, or search change starts the list over from page one.
    useEffect(() => {
        cursorRef.current = null;
        if (!enabled) {
            ++genRef.current; // drop any answer still in flight
            return;
        }
        void fetchPage(null);
    }, [fetchPage, enabled]);

    // Rows from the held party list, to show while the first page is in flight so
    // opening the panel is never a blank wait. Derived, not state: what the server
    // sent always wins, and there is nothing to keep in sync.
    const placeholders = useMemo<T[]>(() => {
        if (!cachePlaceholder || search || !enabled) return [];
        return browseParties(parties, {
            type,
            excludeAccountGroup: hideCreditors ? ACCOUNT_GROUPS.SUNDRY_CREDITORS : undefined,
            limit: BROWSE_PAGE_SIZE,
        }).map(cachePlaceholder);
    }, [cachePlaceholder, search, enabled, type, hideCreditors, parties]);

    // Never over-paint rows already on screen — if the live page won the race, or
    // this is a re-filter with the previous list still showing, the real data
    // stands and the placeholders are simply not consulted.
    //
    // "No rows" from the server is an ANSWER, not an absence: a filter that
    // genuinely matches nobody must show an empty list, never fall back to the
    // held parties as though they were results. So the placeholders stand only
    // until the page for THESE filters has actually landed.
    const shown = !enabled ? NO_ROWS as T[] : items.length > 0 || landedKey === filterKey ? items : placeholders;

    const loadMore = useCallback(() => {
        if (!enabled || !paginated || loadingMore || !cursorRef.current) return;
        setLoadingMore(true);
        void fetchPage(cursorRef.current).finally(() => setLoadingMore(false));
    }, [enabled, paginated, loadingMore, fetchPage]);

    const refresh = useCallback(() => {
        cursorRef.current = null;
        return enabled ? fetchPage(null) : Promise.resolve();
    }, [enabled, fetchPage]);

    const updateItem = useCallback((id: number, patch: Partial<T>) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    }, []);

    return { items: shown, loadingMore, hasMore: enabled && hasMore, loadMore, refresh, updateItem };
}
