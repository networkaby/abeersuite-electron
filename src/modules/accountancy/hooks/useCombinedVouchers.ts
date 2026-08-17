"use client";
// Client-side combiner that fans out to the three voucher GET APIs, normalises
// the heterogeneous row shapes into a single CombinedRow, and sorts by date
// desc / createdAt desc.
//
// WINDOWED + CACHED. This used to fetch every voucher ever written, from all
// three sources, on every single visit — unbounded, and growing forever as the
// books age. The Day Book is opened many times a day (tab to tab, report to
// report), so that was our heaviest repeated read by a distance.
//
// Now it works the way the screen does — pull, supply, save a copy:
//
//   • only the date window on screen is ever fetched, so a first visit costs one
//     period instead of all of history;
//   • what has been fetched is kept in IndexedDB, so returning to a window
//     already held costs one "anything changed?" question, not a re-download;
//   • widening the range fetches ONLY the slice that was missing and stitches it
//     onto what is already held — a period is never pulled twice.
//
// Nothing runs in the background: it checks when the page is opened, revisited,
// or refreshed, and at no other time.

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { idbGet, idbSet } from "@/shared/lib/browser/idbCache";

const CACHE_KEY = "daybook-vouchers:v1";
/** Past this the copy is discarded — the backstop for anything a delta cannot
 *  see, such as a user or branch being RENAMED (those names live on other
 *  tables, and no voucher row is written when they change). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type CombinedSource = "inv" | "gl" | "je";

export type CombinedRow = {
    /** Stable React key: `${source}-${rawId}` (raw IDs may collide across sources). */
    id:          string;
    /** Numeric ID of the underlying record — used for API calls and expand fetches. */
    rawId:       number;
    source:      CombinedSource;
    /** Voucher kind — InvVoucherType, GL VoucherType, or "JOURNAL". */
    kind:        string;
    reference:   string;
    date:        string;
    /** Branch the voucher was recorded in. `inv` rows always carry it; `gl` rows
     *  carry it when their JE lines are branch-stamped (POS receipts/expenditures);
     *  office/legacy `gl` and all `je` rows are org-level (null). */
    branchId?:   string | null;
    branchName?: string | null;
    party:       string | null;
    /** Account id for the party, when the row has one resolved. Used to link
     *  the Party cell to /office/customers/<accountId>. Inventory rows carry
     *  it server-side (resolved from Person/Company id); GL rows source it
     *  from partyAccount.id; JE rows have no party concept. Optional because
     *  per-kind register components fetch their own data and don't always
     *  surface this field. */
    partyAccountId?: number | null;
    /** Whether the party is a Person or a Company — needed so the Day Book
     *  can route to /office/customers/all?personId= or ?companyId= and the
     *  list page can pre-select the right tab. */
    partyKind?:     "person" | "company" | null;
    /** Person.id or Company.id (depending on partyKind) — the value the
     *  customer-list page uses to setSelected. */
    partyEntityId?: number | null;
    narration:   string | null;
    totalAmount: number;
    status:      "DRAFT" | "POSTED" | "CANCELLED";
    cancelledAt: string | null;
    /** ISO timestamp when the row was created — used as the secondary sort
     *  key in the Day Book so rows on the same date stay in true creation
     *  order regardless of source (no inv/gl/je grouping). Optional because
     *  per-kind register components fetch their own data and don't always
     *  surface this field. */
    createdAt?:  string;
    createdBy:   string | null;
    /** Inventory rows only: a live (non-deleted) voucher references this one via
     *  refVoucherId — i.e. it has been converted to its next document. Drives the
     *  "Converted" mark + hides the Convert action. */
    converted?:  boolean;
    /** Inventory rows only: the voucher THIS one was raised against. Not shown,
     *  but it is what lets a delta correct the `converted` mark on a cached row
     *  the delta itself never returned — see applyConvertedUpdates. */
    refVoucherId?: number | null;
};

// Raw shapes as returned by each endpoint — only the fields we read.
type RawInv = {
    id: number; type: string; reference: string; date: string;
    description: string | null; status: "DRAFT" | "POSTED" | "CANCELLED";
    partyName: string | null;
    partyAccountId?: number | null;
    partyPersonId?:  number | null;
    partyCompanyId?: number | null;
    converted?: boolean;
    refVoucherId?: number | null;
    cancelledAt?: string | null;
    totalAmount: number | string;
    createdAt: string;
    createdBy?: { name: string } | null;
    branch?: { id: string; name: string } | null;
};
type RawGl = {
    id: number; type: string; voucherNo: string | null; date: string;
    narration: string | null; status: "DRAFT" | "POSTED" | "CANCELLED";
    partyAccount?: { id: number; name: string; personId: number | null; companyId: number | null } | null;
    cancelledAt?: string | null;
    totalAmount: number | string;
    createdAt: string;
    createdBy?: { name: string } | null;
    // Branch derived from the voucher's JE lines (POS receipts/expenditures
    // stamp the counter's branch; office/legacy GL vouchers have none).
    branch?: { id: string; name: string } | null;
};
type RawJe = {
    id: number | string; voucherNo: string | null; date: string;
    description: string | null; status: "DRAFT" | "POSTED" | "CANCELLED";
    totalDebit?: number | string; totalAmount?: number | string;
    cancelledAt?: string | null;
    createdAt: string;
    createdBy?: { name: string } | null;
};

type Envelope<T> = { mode: "full" | "delta"; rows: T[]; computedAt: string };
type InvEnvelope = Envelope<RawInv> & { convertedUpdates?: Record<number, boolean> };

/** What sits in IndexedDB: the rows plus the window they are known to cover. */
type CachedWindow = {
    rows: CombinedRow[];
    /** Inclusive yyyy-mm-dd bounds of the range actually fetched so far. */
    from: string;
    to: string;
    /** Server clock from the last successful read — the next `since`. */
    checkedAt: string;
    savedAt: number;
};

// ── Normalisers ──────────────────────────────────────────────────────────────

const toInv = (v: RawInv): CombinedRow => ({
    id:          `inv-${v.id}`,
    rawId:       v.id,
    source:      "inv",
    kind:        v.type,
    // Display reader: per-kind Voucher No, else the UVNo label (UV-<id>).
    reference:   v.reference || formatUvNo(v.id),
    date:        v.date,
    branchId:    v.branch?.id   ?? null,
    branchName:  v.branch?.name ?? null,
    party:       v.partyName,
    partyAccountId: v.partyAccountId ?? null,
    partyKind:     v.partyPersonId != null ? "person" : v.partyCompanyId != null ? "company" : null,
    partyEntityId: v.partyPersonId ?? v.partyCompanyId ?? null,
    narration:   v.description,
    totalAmount: Number(v.totalAmount),
    status:      v.status,
    cancelledAt: v.cancelledAt ?? null,
    createdAt:   v.createdAt,
    createdBy:   v.createdBy?.name ?? null,
    converted:   v.converted ?? false,
    refVoucherId: v.refVoucherId ?? null,
});

const toGl = (v: RawGl): CombinedRow => ({
    id:          `gl-${v.id}`,
    rawId:       v.id,
    source:      "gl",
    kind:        v.type,
    // GL spine has no `reference` column — show voucherNo (PMT-/RCT-…)
    // or fall back to the UVNo label so the cell is never blank.
    reference:   v.voucherNo ?? formatUvNo(v.id),
    date:        v.date,
    branchId:    v.branch?.id   ?? null,
    branchName:  v.branch?.name ?? null,
    party:       v.partyAccount?.name ?? null,
    partyAccountId: v.partyAccount?.id ?? null,
    partyKind:     v.partyAccount?.personId != null ? "person"
                  : v.partyAccount?.companyId != null ? "company"
                  : null,
    partyEntityId: v.partyAccount?.personId ?? v.partyAccount?.companyId ?? null,
    narration:   v.narration,
    totalAmount: Number(v.totalAmount),
    status:      v.status,
    cancelledAt: v.cancelledAt ?? null,
    createdAt:   v.createdAt,
    createdBy:   v.createdBy?.name ?? null,
});

const toJe = (e: RawJe): CombinedRow => ({
    id:          `je-${e.id}`,
    rawId:       Number(e.id),
    source:      "je",
    kind:        "JOURNAL",
    reference:   e.voucherNo ?? formatUvNo(Number(e.id)),
    date:        e.date,
    party:       null,
    partyAccountId: null,
    partyKind:     null,
    partyEntityId: null,
    narration:   e.description,
    totalAmount: Number(e.totalDebit ?? e.totalAmount ?? 0),
    status:      e.status,
    cancelledAt: e.cancelledAt ?? null,
    createdAt:   e.createdAt,
    createdBy:   e.createdBy?.name ?? null,
});

// Age-wise sort: newest date first, then newest creation time first within the
// same date. createdAt (not the source-prefixed id) is the tie-breaker so rows
// are NOT grouped by source — the Day Book interleaves all sources chronologically.
const byAge = (a: CombinedRow, b: CombinedRow) => {
    const dd = b.date.localeCompare(a.date);
    if (dd !== 0) return dd;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
};

/**
 * "Converted" is not stored on the voucher — it is true while some OTHER voucher
 * points back at it. So converting an estimate writes the new SALE and leaves the
 * estimate untouched, and a plain "what changed" delta would never correct the
 * estimate's mark. The server resolves the current answer for exactly the ids the
 * changed rows implicate; here we apply it to whatever is already cached.
 */
function applyConvertedUpdates(byId: Map<string, CombinedRow>, updates: Record<number, boolean>) {
    for (const [rawId, converted] of Object.entries(updates)) {
        const key = `inv-${rawId}`;
        const row = byId.get(key);
        if (row) byId.set(key, { ...row, converted });
    }
}

// ── Fetching ─────────────────────────────────────────────────────────────────

/** One slice of calendar, from every source. `since` narrows it to what moved. */
async function fetchSlice(from: string, to: string, since?: string) {
    const params = { sync: "1", from, to, ...(since ? { since } : {}) };
    const [inv, gl, je] = await Promise.all([
        axios.get<InvEnvelope>("/api/inventory/vouchers", { params }),
        axios.get<Envelope<RawGl>>("/api/accountancy/vouchers", { params }),
        axios.get<Envelope<RawJe>>("/api/accountancy/journal-entries", { params }),
    ]);
    return {
        rows: [
            ...(inv.data.rows ?? []).map(toInv),
            ...(gl.data.rows ?? []).map(toGl),
            ...(je.data.rows ?? []).map(toJe),
        ],
        convertedUpdates: inv.data.convertedUpdates ?? {},
        // The oldest of the three clocks, so a row written between two of the
        // calls is re-offered next time instead of slipping through the gap.
        computedAt: [inv.data.computedAt, gl.data.computedAt, je.data.computedAt]
            .filter(Boolean).sort()[0] ?? new Date().toISOString(),
    };
}

const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);
/** yyyy-mm-dd one day either side, for building non-overlapping slices. */
function shiftDay(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

async function readCache(): Promise<CachedWindow | null> {
    const hit = await idbGet<CachedWindow>(CACHE_KEY);
    if (!hit?.rows || !hit.checkedAt) return null;
    if (Date.now() - hit.savedAt > MAX_AGE_MS) return null;
    return hit;
}

/**
 * @param from,to  the window the screen is asking for (yyyy-mm-dd).
 * @param force    skip the cache entirely — the Refresh button and post-edit
 *                 reloads take the window fresh rather than trusting a delta.
 */
async function loadWindow(from: string, to: string, force: boolean): Promise<CachedWindow> {
    const cached = force ? null : await readCache();

    // Nothing usable held — take the whole requested window in one go.
    if (!cached) {
        const { rows, computedAt } = await fetchSlice(from, to);
        return { rows: rows.sort(byAge), from, to, checkedAt: computedAt, savedAt: Date.now() };
    }

    const byId = new Map(cached.rows.map((r) => [r.id, r]));

    // Slices of the request that the cache has never covered. `to` is normally
    // today, so in practice this is the "user looked further back" case.
    const missing: [string, string][] = [];
    if (from < cached.from) missing.push([from, shiftDay(cached.from, -1)]);
    if (to   > cached.to)   missing.push([shiftDay(cached.to, 1), to]);

    // The overlap is already held, so it only needs "what moved since last time".
    const overlapFrom = maxDate(from, cached.from);
    const overlapTo   = minDate(to,   cached.to);
    const jobs: Promise<Awaited<ReturnType<typeof fetchSlice>>>[] = [];
    if (overlapFrom <= overlapTo) jobs.push(fetchSlice(overlapFrom, overlapTo, cached.checkedAt));
    for (const [f, t] of missing) jobs.push(fetchSlice(f, t));

    const results = await Promise.all(jobs);
    for (const res of results) {
        // Replace by id — never arithmetic on a previous value — so an edited or
        // cancelled voucher lands as its current self and cannot drift.
        for (const row of res.rows) byId.set(row.id, row);
        applyConvertedUpdates(byId, res.convertedUpdates);
    }

    return {
        rows: [...byId.values()].sort(byAge),
        from: minDate(from, cached.from),
        to:   maxDate(to,   cached.to),
        // Oldest clock across the slices we actually read, so nothing is skipped.
        checkedAt: results.map((r) => r.computedAt).sort()[0] ?? cached.checkedAt,
        savedAt: Date.now(),
    };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param from,to  the visible window (yyyy-mm-dd). Widening it fetches only the
 *                 part that was missing; narrowing it fetches nothing at all.
 */
export function useCombinedVouchers(from: string, to: string) {
    const [rows,    setRows]    = useState<CombinedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState<string | null>(null);
    const [tick,    setTick]    = useState(0);
    // Refresh (and any post-edit reload) must not be answerable from cache.
    const forceNext = useRef(false);

    const reload = useCallback(() => {
        forceNext.current = true;
        setTick((t) => t + 1);
    }, []);

    useEffect(() => {
        if (!from || !to) return;
        let cancelled = false;
        const force = forceNext.current;
        forceNext.current = false;

        setLoading(true);
        setError(null);

        // Paint whatever is already held first, so reopening the page is instant
        // and the fetch below only has to top it up.
        void (async () => {
            if (!force) {
                const cached = await readCache();
                if (!cancelled && cached?.rows.length) setRows(cached.rows);
            }
            try {
                const next = await loadWindow(from, to, force);
                if (cancelled) return;
                setRows(next.rows);
                await idbSet(CACHE_KEY, next);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [from, to, tick]);

    return { rows, loading, error, reload };
}
