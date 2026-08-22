"use client";

/**
 * The Day Book's data source.
 *
 * It used to fan out to three voucher endpoints and merge them in the browser,
 * pulling every voucher ever written on every visit. Since the Phase 5 spine work
 * those three endpoints all read one table, so the merge was querying the same
 * table three times — and double-listing every journal. It is one paginated
 * endpoint now: `/api/accountancy/reports/day-book`.
 *
 * Three things shape this file:
 *
 *  • PAGING. A period is a boundary, not a download. "This FY" fetches 50 rows and
 *    stops; scrolling fetches the next 50. Nothing here ever pulls a year at once.
 *
 *  • NORMALISED CACHE. Rows carry ids; branch / user / party NAMES live once in
 *    `refs`. A rename therefore fixes every cached row by changing one map entry,
 *    which is what lets the copy be SYNCED instead of thrown away on a timer (the
 *    old code discarded everything every 24h purely because a rename was invisible
 *    to it).
 *
 *  • LOCAL PERSISTENCE. All trusted machines (any that can log in) keep a local
 *    copy on disk for fast reopening. The login gate ensures only authorised
 *    machines reach this code.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { localDb } from "@/shared/lib/browser/localDb";

const API = "/api/accountancy/reports/day-book";
/** One entry per filter view. Bounded so a session of fiddling can't grow forever. */
const MAX_CACHED_VIEWS = 4;
const SEARCH_DEBOUNCE_MS = 350;

export type CombinedSource = "inv" | "gl" | "je";

// ── Wire shapes ──────────────────────────────────────────────────────────────

/** A row exactly as the server sends it: ids, no names. */
type RawRow = {
    id:             string;
    rawId:          number;
    /** Spine id — the second half of the server's `(date desc, id desc)` sort key. */
    sortId:         number;
    source:         CombinedSource;
    kind:           string;
    reference:      string;
    date:           string;
    narration:      string | null;
    /** Inventory rows only: the FROZEN party snapshot, immutable on a tax invoice. */
    party:          string | null;
    partyAccountId: number | null;
    branchId:       string | null;
    createdById:    number | null;
    totalAmount:    number;
    status:         "DRAFT" | "POSTED" | "CANCELLED";
    cancelledAt:    string | null;
    createdAt:      string;
    converted:      boolean;
};

type RefBranch  = { id: string; name: string };
type RefUser    = { id: number; name: string };
type RefAccount = { id: number; name: string; personId: number | null; companyId: number | null };
type Refs = { branches: RefBranch[]; users: RefUser[]; accounts: RefAccount[] };

type DayBookResponse = {
    mode:       "page" | "delta";
    rows:       RawRow[];
    deleted:    string[];
    nextCursor: number | null;
    overflow:   boolean;
    refs:       Refs;
    computedAt: string;
};

/** A row with its names joined back on — what the register table renders. */
export type CombinedRow = Omit<RawRow, "party"> & {
    party:         string | null;
    branchName:    string | null;
    createdBy:     string | null;
    partyKind:     "person" | "company" | null;
    partyEntityId: number | null;
};

export type DayBookQuery = {
    from:      string;
    to:        string;
    kind?:     string;
    statuses?: string[];
    branchId?: string;
    /** "optional" | "inventory" — the Day Book's category quick-filters. */
    category?: string;
    search?:   string;
};

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Server order: newest date first, newest spine id first within a date. */
const byAge = (a: RawRow, b: RawRow) => {
    const d = b.date.localeCompare(a.date);
    return d !== 0 ? d : b.sortId - a.sortId;
};

type Store = {
    rows:       RawRow[];
    refs:       Refs;
    nextCursor: number | null;
    /** Server clock from the last successful read — the next `since`. */
    checkedAt:  string | null;
};

const EMPTY_STORE: Store = {
    rows: [], refs: { branches: [], users: [], accounts: [] }, nextCursor: null, checkedAt: null,
};

/** One Dexie row per filter view — see `localDb`'s `dayBookViews`. */
type CachedView = Store & { savedAt: number };

/**
 * Identifies a filter view. `search` is deliberately excluded — a searched view is
 * transient and never cached, so keying on it would fill the cache with one-offs
 * and evict the everyday unfiltered view that actually benefits.
 */
function viewKey(q: DayBookQuery): string {
    return [
        q.from, q.to, q.kind ?? "", (q.statuses ?? []).slice().sort().join("+"),
        q.branchId ?? "", q.category ?? "",
    ].join("|");
}

function mergeRefs(prev: Refs, next: Refs): Refs {
    // Branch and User arrive whole on every response, so the newest wins outright
    // — that is what makes a rename in either self-correct with no bookkeeping.
    // Accounts arrive partially (this page's + whatever changed), so they accumulate.
    const accounts = new Map(prev.accounts.map((a) => [a.id, a]));
    for (const a of next.accounts) accounts.set(a.id, a);
    return {
        branches: next.branches.length > 0 ? next.branches : prev.branches,
        users:    next.users.length    > 0 ? next.users    : prev.users,
        accounts: [...accounts.values()],
    };
}

function joinRows(rows: RawRow[], refs: Refs): CombinedRow[] {
    const branchById = new Map(refs.branches.map((b) => [b.id, b.name]));
    const userById   = new Map(refs.users.map((u) => [u.id, u.name]));
    const accById    = new Map(refs.accounts.map((a) => [a.id, a]));

    return rows.map((r) => {
        const acc = r.partyAccountId != null ? accById.get(r.partyAccountId) : undefined;
        return {
            ...r,
            branchName: r.branchId != null ? branchById.get(r.branchId) ?? null : null,
            createdBy:  r.createdById != null ? userById.get(r.createdById) ?? null : null,
            // Inventory rows already carry their frozen snapshot name; GL rows
            // resolve the live account name here.
            party:         r.party ?? acc?.name ?? null,
            partyKind:     acc?.personId != null ? "person" : acc?.companyId != null ? "company" : null,
            partyEntityId: acc?.personId ?? acc?.companyId ?? null,
        };
    });
}

/**
 * Fold a delta into what is already held.
 *
 * Rows are replaced by id, never adjusted from a previous value, so an edited or
 * cancelled voucher lands as its current self and cannot drift. Rows the delta
 * reports from BEYOND the loaded prefix are dropped: the client holds a
 * contiguous run from `to` back to its cursor, and letting an older row in would
 * strand it in the middle of a list it does not belong to.
 */
function applyDelta(store: Store, res: DayBookResponse): Store {
    const byId = new Map(store.rows.map((r) => [r.id, r]));
    for (const id of res.deleted) byId.delete(id);

    // Null cursor means everything down to the period start is held, so there is
    // no "beyond" and every returned row belongs.
    const boundary = store.nextCursor != null && store.rows.length > 0
        ? store.rows[store.rows.length - 1]
        : null;

    for (const row of res.rows) {
        if (boundary && byAge(row, boundary) > 0) continue;
        byId.set(row.id, row);
    }

    return {
        rows:       [...byId.values()].sort(byAge),
        refs:       mergeRefs(store.refs, res.refs),
        nextCursor: store.nextCursor,
        checkedAt:  res.computedAt,
    };
}

async function fetchDayBook(
    q: DayBookQuery,
    search: string,
    opts: { cursor?: number | null; since?: string | null } = {},
): Promise<DayBookResponse> {
    const { data } = await axios.get<DayBookResponse>(API, {
        params: {
            from: q.from,
            to:   q.to,
            ...(q.kind && q.kind !== "__all__" ? { kind: q.kind } : {}),
            ...((q.statuses ?? []).length > 0 ? { statuses: (q.statuses ?? []).join(",") } : {}),
            ...(q.branchId && q.branchId !== "__all__" ? { branchId: q.branchId } : {}),
            ...(q.category ? { category: q.category } : {}),
            ...(search ? { search } : {}),
            ...(opts.cursor ? { cursor: opts.cursor } : {}),
            ...(opts.since  ? { since: opts.since, refsSince: opts.since } : {}),
        },
    });
    return data;
}

// ── Cache (counter machines only) ────────────────────────────────────────────

async function readCachedView(key: string): Promise<Store | null> {
    const db = localDb();
    if (!db) return null;
    const row = await db.dayBookViews.get(key);
    const hit = row?.store as CachedView | undefined;
    if (!hit?.rows?.length || !hit.checkedAt) return null;
    return { rows: hit.rows, refs: hit.refs, nextCursor: hit.nextCursor, checkedAt: hit.checkedAt };
}

async function writeCachedView(key: string, store: Store): Promise<void> {
    const db = localDb();
    if (!db) return;
    const savedAt = Date.now();
    await db.transaction("rw", db.dayBookViews, async () => {
        // One row per view, so recording this view no longer means rewriting
        // every other cached view alongside it.
        await db.dayBookViews.put({ key, store: { ...store, savedAt }, savedAt });

        // Keep only the most recently written views.
        const stale = (await db.dayBookViews.orderBy("savedAt").reverse().toArray()).slice(MAX_CACHED_VIEWS);
        if (stale.length) await db.dayBookViews.bulkDelete(stale.map((v) => v.key));
    });
}

function useDebounced<T>(value: T, ms: number): T {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return settled;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDayBook(query: DayBookQuery) {
    const [store,       setStore]       = useState<Store>(EMPTY_STORE);
    const [loading,     setLoading]     = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error,       setError]       = useState<string | null>(null);
    /** Showing a saved copy because the network could not be reached. */
    const [stale,       setStale]       = useState(false);
    const [tick,        setTick]        = useState(0);

    const search = useDebounced(query.search?.trim() ?? "", SEARCH_DEBOUNCE_MS);
    const key = viewKey(query);
    // A searched view is transient — never read from or written to the cache.
    const cacheable = search === "";

    // Refresh (and any post-edit reload) must not be answered from a delta.
    const forceNext = useRef(false);
    // loadMore reads these without wanting to re-subscribe to every change.
    const storeRef  = useRef(store);
    storeRef.current = store;
    // The in-flight guard for loadMore lives in a ref, not in the state value.
    // Reading the state there would make `loadMore` a new function every time a
    // page finished, and the page's IntersectionObserver — which depends on it —
    // would rebuild and re-observe. `io.observe()` fires immediately for an
    // element that is already intersecting, so that rebuild pulled a second page
    // nobody asked for. The spinner still reads the state.
    const loadingMoreRef = useRef(false);
    /** Guards `syncNow` — a second signal must not overlap the read in flight. */
    const syncingRef = useRef(false);

    const reload = useCallback(() => {
        forceNext.current = true;
        setTick((t) => t + 1);
    }, []);

    useEffect(() => {
        if (!query.from || !query.to) return;
        let cancelled = false;
        const force = forceNext.current;
        forceNext.current = false;

        setLoading(true);
        setError(null);
        setStale(false);

        void (async () => {
            let cached: Store | null = null;
            if (cacheable && !force) {
                cached = await readCachedView(key);
                if (cancelled) return;
                // Paint the saved copy immediately so reopening is instant; the
                // sync below only has to top it up.
                if (cached) { setStore(cached); setLoading(false); }
            }

            try {
                if (cached) {
                    const res = await fetchDayBook(query, search, { since: cached.checkedAt });
                    if (cancelled) return;
                    // Too much moved for a delta to be the cheap option — start over.
                    const next = res.overflow
                        ? await (async () => {
                            const fresh = await fetchDayBook(query, search);
                            return { rows: fresh.rows, refs: fresh.refs, nextCursor: fresh.nextCursor, checkedAt: fresh.computedAt };
                        })()
                        : applyDelta(cached, res);
                    if (cancelled) return;
                    setStore(next);
                    if (cacheable) await writeCachedView(key, next);
                } else {
                    const res = await fetchDayBook(query, search);
                    if (cancelled) return;
                    const next: Store = {
                        rows: res.rows, refs: res.refs, nextCursor: res.nextCursor, checkedAt: res.computedAt,
                    };
                    setStore(next);
                    if (cacheable) await writeCachedView(key, next);
                }
            } catch (e) {
                if (cancelled) return;
                // A counter with its copy already on screen stays useful offline —
                // say it is saved rather than replacing the books with an error.
                if (cached) setStale(true);
                else setError(e instanceof Error ? e.message : "Failed to load day book");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
        // `query` is rebuilt every render by callers; `key` + `search` are its
        // identity as far as fetching is concerned.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, search, cacheable, tick]);

    const loadMore = useCallback(() => {
        const current = storeRef.current;
        if (current.nextCursor == null || loadingMoreRef.current) return;

        loadingMoreRef.current = true;
        setLoadingMore(true);
        void (async () => {
            try {
                const res = await fetchDayBook(query, search, { cursor: current.nextCursor });
                const next: Store = {
                    // Append — the server continues from the cursor, so these are
                    // strictly older than everything already held.
                    rows:       [...current.rows, ...res.rows].sort(byAge),
                    refs:       mergeRefs(current.refs, res.refs),
                    nextCursor: res.nextCursor,
                    checkedAt:  current.checkedAt,
                };
                setStore(next);
                if (cacheable) await writeCachedView(key, next);
            } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to load more");
            } finally {
                loadingMoreRef.current = false;
                setLoadingMore(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, search, cacheable]);

    /**
     * Top up what is already on screen — the live path.
     *
     * `reload` starts over from page one, which is the right answer for a person
     * pressing Refresh and the wrong one for a voucher posted at another counter:
     * it would throw away every page the reader had scrolled through, dropping
     * them from 200 rows back to 50 each time anyone saved anything.
     *
     * So this reads a DELTA against the copy in hand and folds it in with the
     * same `applyDelta` the counter cache uses — rows replaced by id, tombstones
     * applied, `nextCursor` untouched, so the loaded run stays loaded. It only
     * falls back to a full reload when there is nothing to be delta against, or
     * when the server says the delta has stopped being the cheap option.
     *
     * Deliberately does NOT touch `loading`: the table on screen is correct and
     * complete, so a spinner would be a flicker announcing nothing.
     */
    const syncNow = useCallback(() => {
        const current = storeRef.current;
        if (!current.checkedAt || current.rows.length === 0) { reload(); return; }
        if (syncingRef.current) return;

        syncingRef.current = true;
        void (async () => {
            try {
                const res = await fetchDayBook(query, search, { since: current.checkedAt });
                if (res.overflow) { reload(); return; }
                // Re-read: a loadMore may have landed while this was in flight.
                const next = applyDelta(storeRef.current, res);
                setStore(next);
                setStale(false);
                if (cacheable) await writeCachedView(key, next);
            } catch {
                // A missed nudge is not an error worth showing — the rows on
                // screen are still the rows we last read, and Refresh is there.
            } finally {
                syncingRef.current = false;
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, search, cacheable, reload]);

    const rows = useMemo(() => joinRows(store.rows, store.refs), [store]);

    return {
        rows,
        loading,
        loadingMore,
        hasMore: store.nextCursor != null,
        error,
        stale,
        loadMore,
        reload,
        /** Fold in what changed elsewhere, keeping the loaded pages. */
        syncNow,
        /** Every branch, not just those on loaded rows — the filter dropdown needs
         *  the full list, which it cannot derive from a page. */
        branches: store.refs.branches,
    };
}
