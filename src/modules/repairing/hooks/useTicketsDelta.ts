"use client";

/**
 * The Repair Tickets board's data source — same shape as the Day Book's
 * `useDayBook`, backed by the local Dexie replica instead of a single JSON blob.
 *
 *  • PAGING. 25 rows a fetch, cursor-walked; a filter view is a boundary, not a
 *    download.
 *
 *  • DELTA. Reopening the board asks the server for rows touched since the last
 *    check (`?since=`) and merges them by id — an edited or re-statused ticket
 *    replaces its old self rather than the client re-pulling everything.
 *
 *  • COUNTER-ONLY PERSISTENCE, same policy as Day Book: ticket rows carry
 *    customer name/phone/device, so only a machine with the counter bridge may
 *    keep a copy on disk. Anywhere else this runs live and stores nothing.
 *
 *  • NO DELETE TOMBSTONE. Tickets don't have an audit log the way vouchers do,
 *    so a hard-deleted ticket inside the loaded window isn't chased down by a
 *    delta — bounded by `MAX_AGE_MS` the same way the POS product cache is.
 *    Hard-deletes are already rare and gated (blocked by linked vouchers/child
 *    tickets), so this is an accepted gap, not an oversight.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { localDb, type LocalTicketRow } from "@/shared/lib/browser/localDb";
import { isBridgeAvailable } from "@/shared/lib/bridge";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";

const API = "/api/tickets";
/** One entry per distinct filter combo. Bounded so a session of fiddling with
 *  filters can't grow the view list forever. */
const MAX_CACHED_VIEWS = 4;
/** Past this a cached view is not trusted at all — the backstop for the missing
 *  delete tombstone (mirrors the POS product cache's own MAX_AGE_MS). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 350;

export type TicketsQuery = {
    pipelineId?: string;
    status?:     string;
    priority?:   string;
    /** "warranty" | "non_warranty" */
    warranty?:   string;
    from?:       string;
    to?:         string;
    search?:     string;
};

/** A row exactly as `flattenRepair` on the server sends it. */
export type TicketRow = Record<string, unknown> & {
    id:        number;
    pipelineId: string | null;
    status:    string;
    priority:  string;
    createdAt: string;
    updatedAt: string;
};

type SyncResponse<T> =
    | { mode: "page";  rows: T[]; nextCursor: number | null; computedAt: string }
    | { mode: "delta"; rows: T[]; overflow: boolean;         computedAt: string };

/**
 * Identifies a filter view. `search` is excluded — a searched view is
 * transient and never cached, matching the Day Book's own reasoning: keying on
 * it would fill the cache with one-offs and evict the everyday unfiltered view.
 */
function viewKey(q: TicketsQuery): string {
    return [q.pipelineId ?? "", q.status ?? "", q.priority ?? "", q.warranty ?? "", q.from ?? "", q.to ?? ""].join("|");
}

/** Server order: newest created first, newest id first within the same instant. */
const byAge = (a: TicketRow, b: TicketRow) => {
    const d = b.createdAt.localeCompare(a.createdAt);
    return d !== 0 ? d : b.id - a.id;
};

async function fetchTickets<T extends TicketRow>(
    q: TicketsQuery,
    search: string,
    opts: { cursor?: number | null; since?: string | null } = {},
): Promise<SyncResponse<T>> {
    const { data } = await axios.get<SyncResponse<T>>(API, {
        params: {
            sync: 1,
            ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
            ...(q.status     ? { status: q.status }         : {}),
            ...(q.priority   ? { priority: q.priority }     : {}),
            ...(q.warranty   ? { warranty: q.warranty }     : {}),
            ...(q.from       ? { from: q.from }             : {}),
            ...(q.to         ? { to: q.to }                 : {}),
            ...(search       ? { search }                   : {}),
            ...(opts.cursor  ? { cursor: opts.cursor }       : {}),
            ...(opts.since   ? { since: opts.since }         : {}),
        },
    });
    return data;
}

type CachedView<T> = { rows: T[]; nextCursor: number | null; checkedAt: string };

async function readCachedView<T extends TicketRow>(key: string): Promise<CachedView<T> | null> {
    const db = localDb();
    if (!db) return null;
    const view = await db.ticketViews.get(key);
    if (!view?.ids.length) return null;
    if (Date.now() - new Date(view.checkedAt).getTime() > MAX_AGE_MS) return null;
    const stored = await db.tickets.bulkGet(view.ids);
    const rows = stored.filter((r): r is LocalTicketRow => r != null) as T[];
    if (rows.length === 0) return null;
    return { rows, nextCursor: view.nextCursor, checkedAt: view.checkedAt };
}

async function writeCachedView<T extends TicketRow>(key: string, rows: T[], nextCursor: number | null, checkedAt: string): Promise<void> {
    const db = localDb();
    if (!db) return;
    await db.transaction("rw", db.tickets, db.ticketViews, async () => {
        // Rows are stored as the server shaped them; the indexed columns
        // (status / priority / updatedAt) are already top-level scalars on them.
        await db.tickets.bulkPut(rows as LocalTicketRow[]);
        await db.ticketViews.put({ key, ids: rows.map((r) => r.id), nextCursor, checkedAt, savedAt: Date.now() });

        // Keep only the most recently written views — the shared `tickets`
        // rows themselves are harmless to leave behind either way.
        const stale = (await db.ticketViews.orderBy("savedAt").reverse().toArray()).slice(MAX_CACHED_VIEWS);
        if (stale.length) await db.ticketViews.bulkDelete(stale.map((v) => v.key));
    });
}

export function useTicketsDelta<T extends TicketRow>(query: TicketsQuery) {
    const [rows,        setRows]        = useState<T[]>([]);
    const [loading,     setLoading]     = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error,       setError]       = useState<string | null>(null);
    const [stale,       setStale]       = useState(false);
    const [nextCursor,  setNextCursor]  = useState<number | null>(null);
    const [tick,        setTick]        = useState(0);

    const search = useDebouncedValue(query.search?.trim() ?? "", SEARCH_DEBOUNCE_MS);
    const key = viewKey(query);
    const cacheable = search === "";

    const checkedAtRef = useRef<string | null>(null);
    const rowsRef       = useRef<T[]>([]);
    rowsRef.current = rows;
    const bridgeRef  = useRef(false);
    const forceNext  = useRef(false);

    const reload = useCallback(() => {
        forceNext.current = true;
        setTick((t) => t + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;
        const force = forceNext.current;
        forceNext.current = false;

        setLoading(true);
        setError(null);
        setStale(false);

        void (async () => {
            const onCounter = await isBridgeAvailable();
            if (cancelled) return;
            bridgeRef.current = onCounter;

            let cached: CachedView<T> | null = null;
            if (onCounter && cacheable && !force) {
                cached = await readCachedView<T>(key);
                if (cancelled) return;
                if (cached) {
                    setRows(cached.rows);
                    setNextCursor(cached.nextCursor);
                    checkedAtRef.current = cached.checkedAt;
                    setLoading(false);
                }
            }

            try {
                if (cached) {
                    const res = await fetchTickets<T>(query, search, { since: cached.checkedAt });
                    if (cancelled) return;

                    if (res.mode === "delta" && res.overflow) {
                        const fresh = await fetchTickets<T>(query, search);
                        if (cancelled || fresh.mode !== "page") return;
                        setRows(fresh.rows);
                        setNextCursor(fresh.nextCursor);
                        checkedAtRef.current = fresh.computedAt;
                        if (onCounter && cacheable) await writeCachedView(key, fresh.rows, fresh.nextCursor, fresh.computedAt);
                    } else if (res.mode === "delta") {
                        const byId = new Map(rowsRef.current.map((r) => [r.id, r]));
                        for (const r of res.rows) byId.set(r.id, r);
                        const merged = [...byId.values()].sort(byAge);
                        setRows(merged);
                        checkedAtRef.current = res.computedAt;
                        if (onCounter && cacheable) await writeCachedView(key, merged, cached.nextCursor, res.computedAt);
                    }
                } else {
                    const res = await fetchTickets<T>(query, search);
                    if (cancelled || res.mode !== "page") return;
                    setRows(res.rows);
                    setNextCursor(res.nextCursor);
                    checkedAtRef.current = res.computedAt;
                    if (onCounter && cacheable) await writeCachedView(key, res.rows, res.nextCursor, res.computedAt);
                }
            } catch (e) {
                if (cancelled) return;
                if (cached) setStale(true);
                else setError(e instanceof Error ? e.message : "Failed to load tickets");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
        // `query` is rebuilt every render by the caller; `key` + `search` are its
        // identity as far as fetching is concerned.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, search, cacheable, tick]);

    const loadMore = useCallback(() => {
        if (nextCursor == null || loadingMore) return;
        setLoadingMore(true);
        void (async () => {
            try {
                const res = await fetchTickets<T>(query, search, { cursor: nextCursor });
                if (res.mode !== "page") return;
                const merged = [...rowsRef.current, ...res.rows].sort(byAge);
                setRows(merged);
                setNextCursor(res.nextCursor);
                if (bridgeRef.current && cacheable) {
                    await writeCachedView(key, merged, res.nextCursor, checkedAtRef.current ?? res.computedAt);
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to load more");
            } finally {
                setLoadingMore(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, search, cacheable, nextCursor, loadingMore]);

    return {
        rows, loading, loadingMore,
        hasMore: nextCursor != null,
        error, stale, loadMore, reload,
    };
}
