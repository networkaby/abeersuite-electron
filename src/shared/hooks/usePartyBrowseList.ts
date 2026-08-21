"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { browseParties, cacheParties, type Party } from "@/shared/lib/parties";
import type { PartyType } from "@/shared/lib/browser/localDb";
import { BROWSE_PAGE_SIZE, type BrowseCursor } from "@/shared/lib/parties/browsePage";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import type { PartySort } from "@/modules/customer/lib/partySort";

/**
 * Grow-on-scroll list fetching, shared by the Contacts (Person) and Companies
 * browse pages — the same feature over two tables, so one hook drives both
 * rather than each page reinventing pagination and cache feed-back on its own.
 *
 * Every page this fetches — scrolled to or searched into — also tops up the
 * SAME cache the till and every voucher party picker read (`partyCatalog.ts`).
 * A customer found once while browsing here is then free to search for at the
 * till; that reuse is the point, not a side effect bolted on.
 *
 * Server-side pagination covers Name-ascending only (see `browsePage.ts` for
 * why). Any other sort — Name descending, Amount either way — asks for one
 * unbounded page and stops there, exactly like the pages did before this hook
 * existed; `loadMore` is simply inert in that case.
 *
 * It also paints from the cache while the first page is in flight, when the
 * caller supplies `cachePlaceholder` — see that option for the two deliberate
 * limits on when that happens, both of which come down to never showing a
 * partial list as if it were the whole one.
 */

/** The subset of a browse row this hook needs — both `CustomerListItem` and
 *  `CompanyListItem` already carry it (the extra fields added purely to feed
 *  the cache — see /api/person and /api/companies). */
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

function toParty(type: PartyType, r: BrowseListRow): Party {
    return {
        type,
        id: r.id,
        name: r.name,
        address: r.address ?? null,
        phones: r.phones?.map((p) => p.phone) ?? [],
        emails: r.emails?.map((e) => e.email) ?? [],
        accountId: r.account?.id ?? null,
        accountGroup: r.accountGroup ?? null,
        accountGroupType: r.accountGroupType ?? null,
        aliases: r.aliases ?? [],
        // Neither browse page fetches the linked-company LIST (only a count) —
        // a party cached from here shows none until the till's own lookup fills
        // it in, which only matters to a "bill this person's employer" picker,
        // not to being found at all.
        linkedCompanies: [],
        cachedAt: 0,
    };
}

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
}): {
    items: T[];
    loadingMore: boolean;
    loadMore: () => void;
    /** Reload from page one with the current filters — after a create, delete,
     *  or reactivate changes which rows belong in the list at all. */
    refresh: () => Promise<void>;
    /** Patch one already-loaded row in place — for an edit that changes how a
     *  row displays (e.g. a renamed party) without changing which rows belong
     *  in the list, so it doesn't need a full reload. */
    updateItem: (id: number, patch: Partial<T>) => void;
} {
    const { type, apiPath, search, sort, hideCreditors, includeInactive, errorMessage, cachePlaceholder } = opts;
    const [items, setItems] = useState<T[]>([]);
    const [loadingMore, setLoadingMore] = useState(false);
    const cursorRef = useRef<BrowseCursor | null>(null);
    // Bumped on every fresh fetch so a slow response from a since-abandoned
    // filter combination can't land after a newer one already has.
    const genRef = useRef(0);

    const paginated = sort.key === "name" && sort.dir === "asc";

    const fetchPage = useCallback((cursor: BrowseCursor | null) => {
        const gen = ++genRef.current;
        const params: Record<string, string> = {
            ...(search ? { q: search } : {}),
            ...(hideCreditors ? { hideCreditors: "1" } : {}),
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
                setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));

                const active = data.items.filter((r) => r.isActive);
                if (active.length > 0) void cacheParties(active.map((r) => toParty(type, r)));
            })
            .catch(() => { if (genRef.current === gen) toast.error(errorMessage); });
    }, [apiPath, search, hideCreditors, includeInactive, paginated, type, errorMessage]);

    // Any filter, sort, or search change starts the list over from page one.
    useEffect(() => {
        cursorRef.current = null;
        void fetchPage(null);
    }, [fetchPage]);

    // Paint the regulars from the cache while that first page is in flight, so
    // opening the panel is never a blank wait. Deliberately does NOT clear on
    // cleanup: these rows are replaced wholesale the moment the live page lands,
    // and blanking them first would put back the flicker this removes.
    useEffect(() => {
        if (!cachePlaceholder || search) return;
        let cancelled = false;
        void browseParties({
            type,
            excludeAccountGroup: hideCreditors ? ACCOUNT_GROUPS.SUNDRY_CREDITORS : undefined,
            limit: BROWSE_PAGE_SIZE,
        }).then((cached) => {
            if (cancelled || cached.length === 0) return;
            // Never over-paint rows already on screen — if the live page won the
            // race, or this is a re-filter with the previous list still showing,
            // the real data stands.
            setItems((prev) => (prev.length > 0 ? prev : cached.map(cachePlaceholder)));
        });
        return () => { cancelled = true; };
    }, [cachePlaceholder, search, type, hideCreditors]);

    const loadMore = useCallback(() => {
        if (!paginated || loadingMore || !cursorRef.current) return;
        setLoadingMore(true);
        void fetchPage(cursorRef.current).finally(() => setLoadingMore(false));
    }, [paginated, loadingMore, fetchPage]);

    const refresh = useCallback(() => {
        cursorRef.current = null;
        return fetchPage(null);
    }, [fetchPage]);

    const updateItem = useCallback((id: number, patch: Partial<T>) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    }, []);

    return { items, loadingMore, loadMore, refresh, updateItem };
}
