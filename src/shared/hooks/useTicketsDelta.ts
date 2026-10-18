"use client";

/**
 * The shared Dexie-cached + delta-synced data source for every Ticket-flavoured
 * board (Repair Tickets, Deals, Help Desk, Administration tasks). All four are
 * the same `Ticket` model under a different `pipelineId` (see the "Unified
 * Ticket merge" design), so they share one local replica instead of one Dexie
 * table per board:
 *
 *  • CACHE. Rows land in the same `tickets` Dexie table (keyed by the ticket's
 *    own globally-unique id, so a deal, a help ticket and a repair ticket never
 *    collide) and `ticketViews` holds one row per board (`apiPath` is folded
 *    into the view key so Deals' "whole board" view can't collide with Help's).
 *    Reopening a board reads the local copy first — the Ticket table overall is
 *    large, so this is what avoids a cold DB round-trip on every open/close.
 *
 *  • DELTA. `?since=` asks the server for rows touched since the last check and
 *    merges them by id — an edited or re-statused ticket replaces its old self
 *    rather than the client re-pulling the whole board.
 *
 *  • REALTIME. Wired to the app's one shared change channel: any write that
 *    touches the "tickets" topic (any of `/api/tickets`, `/api/deals`,
 *    `/api/help`, `/api/admin-tasks`, …) nudges every OPEN board to re-check,
 *    live, at zero extra connection cost — see `useRealtimeTopics`.
 *
 *  • LOCAL PERSISTENCE. All trusted machines (any that can log in) keep a local
 *    copy on disk for fast reopening. The login gate ensures only authorised
 *    machines reach this code.
 *
 *  • LOCAL-READ COUNTER. On a till serving screens from its replica the replica IS
 *    the local copy, and the rules above bend two ways. The server ignores `since`
 *    there (`parseSince`) and answers with a full page — rows land in the replica
 *    seconds after Supabase stamped them, so a "changed since my last read" stamp
 *    taken from the replica's clock can sit PAST a row that has not arrived yet and
 *    hide it for good. And after the board's OWN save the row is still in flight, so
 *    `afterOwnWrite` reads nothing until the worker says the rows have landed
 *    (`sync:applied`); reading at once would snap the optimistic change back. That
 *    still leaves one read it does not own: a cycle ALREADY RUNNING when the save
 *    landed reports `sync:applied` for other tables, and the re-read that triggers
 *    answers from a replica without this row — the card jumps back and returns on the
 *    next cycle. So `afterOwnWrite` also PINS the row the server answered with: any
 *    copy read back with an older `updatedAt` is not believed.
 *
 *  • NO DELETE TOMBSTONE, same accepted gap as before: a hard-deleted ticket
 *    inside the loaded window isn't chased down by a delta, bounded by
 *    `MAX_AGE_MS` instead. Hard-deletes are rare and gated.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import axios from "axios";
import { localDb, type LocalTicketRow } from "@/shared/lib/browser/localDb";
import { useDebouncedValue } from "./useDebouncedValue";
import { useRealtimeTopics } from "./useRealtimeTopics";
import { getReadsGoLocal, getWritesHeldUntilApplied } from "@/shared/lib/realtime/appChannel";
import { SYNC_APPLIED_EVENT } from "@/shared/lib/realtime/syncApplied";

const DEFAULT_API = "/api/tickets";
/** One entry per distinct filter combo per board. Bounded so a session of
 *  fiddling with filters (or several boards open across a session) can't grow
 *  the view list forever. */
const MAX_CACHED_VIEWS = 8;
/** Past this a cached view is not trusted at all — the backstop for the missing
 *  delete tombstone (mirrors the POS product cache's own MAX_AGE_MS). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 350;
/** After the board's own save on a replica-reading till, how long to wait for the
 *  worker's `sync:applied` before reading anyway (its realtime link may be down). */
const OWN_WRITE_FALLBACK_MS = 6_000;
/** How long a just-written row outranks an older copy read back from a replica that
 *  has not caught up. Comfortably longer than a sync cycle, and short enough that it
 *  can never mask somebody else's later edit. */
const OWN_WRITE_PIN_MS = 60_000;

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

/**
 * The base shape every board's row must carry — the fields this hook itself
 * reads (merge-by-id, cache expiry, the default age sort). Deliberately NOT
 * intersected with `Record<string, unknown>`: the source DTOs (Ticket, DealDto,
 * HelpDto, TaskDto) are closed interfaces with no index signature, and
 * requiring one here would make none of them satisfy the constraint.
 */
export type TicketRow = {
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
 * Identifies a filter view, namespaced by which board (`apiPath`) it belongs
 * to — Deals' "whole board" view and Help's must not collide just because
 * both pass an empty query. `search` is excluded — a searched view is
 * transient and never cached (keying on it would fill the cache with one-offs
 * and evict the everyday unfiltered view).
 */
function viewKey(apiPath: string, q: TicketsQuery): string {
    return [apiPath, q.pipelineId ?? "", q.status ?? "", q.priority ?? "", q.warranty ?? "", q.from ?? "", q.to ?? ""].join("|");
}

/** Default order: newest created first, newest id first within the same instant. */
const byAge = (a: TicketRow, b: TicketRow) => {
    const d = b.createdAt.localeCompare(a.createdAt);
    return d !== 0 ? d : b.id - a.id;
};

async function fetchTickets<T extends TicketRow>(
    apiPath: string,
    q: TicketsQuery,
    search: string,
    opts: { cursor?: number | null; since?: string | null } = {},
): Promise<SyncResponse<T>> {
    const { data } = await axios.get<SyncResponse<T>>(apiPath, {
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

export type UseTicketsDeltaOptions<T extends TicketRow> = {
    /** Which board endpoint to sync against. Defaults to the Repair Tickets API. */
    apiPath?: string;
    /** Merge order for the combined rows. Defaults to newest-first by createdAt —
     *  boards with their own manual drag order (Deals/Help/Administration, which
     *  carry a server-computed `order`) should pass a comparator over that field
     *  instead, so a delta merge doesn't scramble a hand-ordered column. */
    sort?: (a: T, b: T) => number;
};

export function useTicketsDelta<T extends TicketRow>(query: TicketsQuery, options: UseTicketsDeltaOptions<T> = {}) {
    const apiPath = options.apiPath ?? DEFAULT_API;
    const sort = options.sort ?? (byAge as unknown as (a: T, b: T) => number);

    const [rows,        setRows]       = useState<T[]>([]);
    const [loading,     setLoading]     = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error,       setError]       = useState<string | null>(null);
    const [stale,       setStale]       = useState(false);
    const [nextCursor,  setNextCursor]  = useState<number | null>(null);
    const [tick,        setTick]        = useState(0);

    const search = useDebouncedValue(query.search?.trim() ?? "", SEARCH_DEBOUNCE_MS);
    const key = viewKey(apiPath, query);
    const cacheable = search === "";

    const checkedAtRef = useRef<string | null>(null);
    const rowsRef       = useRef<T[]>([]);
    rowsRef.current = rows;
    // The caller rebuilds `sort` every render; afterOwnWrite reads the latest through
    // this rather than carrying it in a dependency list.
    const sortRef = useRef(sort);
    sortRef.current = sort;
    const forceNext  = useRef(false);

    /** Rows this board has just written itself, each held against any copy that comes
     *  back older than the one the server answered with. See the module doc's
     *  LOCAL-READ COUNTER note for the read this exists to survive. Self-clearing: a
     *  pin goes the moment a read answers with that stamp or newer, and by time, so a
     *  row that is deleted or filtered away elsewhere can never stick to the board. */
    const pinned = useRef(new Map<number, { row: T; at: number }>());

    const applyPins = useCallback((rows: T[]): T[] => {
        const pins = pinned.current;
        if (pins.size === 0) return rows;
        const now = Date.now();
        for (const [id, pin] of pins) if (now - pin.at > OWN_WRITE_PIN_MS) pins.delete(id);
        if (pins.size === 0) return rows;
        return rows.map((r) => {
            const pin = pins.get(r.id);
            if (!pin) return r;
            if (Date.parse(r.updatedAt) >= Date.parse(pin.row.updatedAt)) {
                pins.delete(r.id);   // the read caught up — this row governs itself again
                return r;
            }
            return pin.row;
        });
    }, []);

    /** Manual/forced refresh — bypasses the local cache entirely (the Reload
     *  button, and right after this tab's own save). */
    const reload = useCallback(() => {
        forceNext.current = true;
        setTick((t) => t + 1);
    }, []);

    /** A soft nudge — re-runs the normal cache→delta path, so a realtime signal
     *  costs only what actually changed, not a full re-pull. */
    const refresh = useCallback(() => {
        setTick((t) => t + 1);
    }, []);

    /** The board's OWN write just succeeded. Off a counter, or on a till whose writes
     *  are held until its replica has the rows (v_live), that is a plain `reload`. On a
     *  till reading its replica while writing live the row is still in flight: reading
     *  now would show the old state — snapping an optimistic move back — and stamp the
     *  cache past the row. So nothing is read until the worker's `sync:applied`, which
     *  the topic subscription below already answers; the timer only covers a worker
     *  whose realtime link is down. See the module doc, LOCAL-READ COUNTER. */
    const ownWriteWait = useRef<(() => void) | null>(null);
    const clearOwnWriteWait = useCallback(() => {
        ownWriteWait.current?.();
        ownWriteWait.current = null;
    }, []);
    useEffect(() => clearOwnWriteWait, [clearOwnWriteWait]);

    const afterOwnWrite = useCallback((saved?: unknown) => {
        // The row as the SERVER has it, when the caller has one to give — every board's
        // own PATCH answers with it. A dialog that only reports "saved" (or hands back
        // an id) still gets the wait below, just without the guard.
        if (saved && typeof saved === "object") {
            const row = saved as T;
            if (typeof row.id === "number" && typeof row.updatedAt === "string") {
                pinned.current.set(row.id, { row, at: Date.now() });
                // Show the server's own copy at once: it carries what the optimistic
                // patch could only guess at (stage order, completedAt, counts). Placed
                // straight in, NOT through `applyPins` — that clears a pin whose stamp
                // a row has reached, and this row is the pin itself.
                setRows((rs) => rs.map((r) => (r.id === row.id ? row : r)).sort(sortRef.current));
            }
        }
        if (!getReadsGoLocal() || getWritesHeldUntilApplied()) { reload(); return; }
        clearOwnWriteWait();
        const onApplied = () => clearOwnWriteWait();
        const timer = setTimeout(() => { clearOwnWriteWait(); reload(); }, OWN_WRITE_FALLBACK_MS);
        window.addEventListener(SYNC_APPLIED_EVENT, onApplied);
        ownWriteWait.current = () => {
            clearTimeout(timer);
            window.removeEventListener(SYNC_APPLIED_EVENT, onApplied);
        };
    }, [reload, clearOwnWriteWait]);

    useEffect(() => {
        let cancelled = false;
        const force = forceNext.current;
        forceNext.current = false;

        setLoading(true);
        setError(null);
        setStale(false);

        void (async () => {
            let cached: CachedView<T> | null = null;
            if (cacheable && !force) {
                cached = await readCachedView<T>(key);
                if (cancelled) return;
                if (cached) {
                    setRows(applyPins([...cached.rows]).sort(sort));
                    setNextCursor(cached.nextCursor);
                    checkedAtRef.current = cached.checkedAt;
                    setLoading(false);
                }
            }

            try {
                if (cached) {
                    const res = await fetchTickets<T>(apiPath, query, search, { since: cached.checkedAt });
                    if (cancelled) return;

                    // A page answer to a `since` request means the server declined the
                    // delta (a replica-served read — see parseSince); an overflow means
                    // too much moved for one. Either way a full page replaces the view.
                    const fresh = res.mode === "page" ? res
                        : res.overflow ? await fetchTickets<T>(apiPath, query, search)
                        : null;
                    if (cancelled) return;
                    if (fresh) {
                        if (fresh.mode !== "page") return;
                        const sorted = applyPins([...fresh.rows]).sort(sort);
                        setRows(sorted);
                        setNextCursor(fresh.nextCursor);
                        checkedAtRef.current = fresh.computedAt;
                        if (cacheable) await writeCachedView(key, sorted, fresh.nextCursor, fresh.computedAt);
                    } else if (res.mode === "delta") {
                        const byId = new Map(rowsRef.current.map((r) => [r.id, r]));
                        for (const r of res.rows) byId.set(r.id, r);
                        const merged = applyPins([...byId.values()]).sort(sort);
                        setRows(merged);
                        checkedAtRef.current = res.computedAt;
                        if (cacheable) await writeCachedView(key, merged, cached.nextCursor, res.computedAt);
                    }
                } else {
                    const res = await fetchTickets<T>(apiPath, query, search);
                    if (cancelled || res.mode !== "page") return;
                    const sorted = applyPins([...res.rows]).sort(sort);
                    setRows(sorted);
                    setNextCursor(res.nextCursor);
                    checkedAtRef.current = res.computedAt;
                    if (cacheable) await writeCachedView(key, sorted, res.nextCursor, res.computedAt);
                }
            } catch (e) {
                if (cancelled) return;
                if (cached) setStale(true);
                else setError(e instanceof Error ? e.message : "Failed to load");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
        // `query`/`sort` are rebuilt every render by the caller; `key` + `search`
        // are `query`'s identity as far as fetching is concerned, and `sort` is
        // only ever read inside the closure above, never used to decide whether
        // to refetch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, search, cacheable, tick, applyPins]);

    // A change anywhere that touches this board's topic re-checks it live — see
    // the module doc's REALTIME section. Coalesced and hidden-tab-safe already
    // (useRealtimeTopics), so this costs nothing on a quiet board.
    useRealtimeTopics(["tickets"], refresh);

    const loadMore = useCallback(() => {
        if (nextCursor == null || loadingMore) return;
        setLoadingMore(true);
        void (async () => {
            try {
                const res = await fetchTickets<T>(apiPath, query, search, { cursor: nextCursor });
                if (res.mode !== "page") return;
                const merged = applyPins([...rowsRef.current, ...res.rows]).sort(sort);
                setRows(merged);
                setNextCursor(res.nextCursor);
                if (cacheable) {
                    await writeCachedView(key, merged, res.nextCursor, checkedAtRef.current ?? res.computedAt);
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to load more");
            } finally {
                setLoadingMore(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` + `search` are query's identity; see the fetch effect above
    }, [key, search, cacheable, nextCursor, loadingMore, applyPins]);

    return {
        rows,
        /** Optimistic local patch (e.g. an instant drag-move before the server
         *  confirms). A later delta/realtime refresh reconciles it with truth. */
        setRows: setRows as Dispatch<SetStateAction<T[]>>,
        loading, loadingMore,
        hasMore: nextCursor != null,
        error, stale, loadMore, reload, afterOwnWrite,
    };
}
