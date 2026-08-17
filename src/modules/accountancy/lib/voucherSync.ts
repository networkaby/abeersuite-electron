/**
 * Server half of the Day Book's windowed cache.
 *
 * The Day Book used to pull EVERY voucher ever written — three unbounded
 * fetches, re-run from scratch on every visit, growing forever as the books
 * age. It now keeps what it has fetched in the browser and asks only for what
 * it is missing, in two forms:
 *
 *   • a WINDOW (`from`/`to`) — the date range on screen, so a first visit costs
 *     one period rather than all of history, and widening the range fetches
 *     just the slice that was not already held;
 *   • a DELTA (`since`) — "what changed in that window since I last looked",
 *     so revisiting a window already cached costs almost nothing.
 *
 * All three voucher endpoints take the same three params and answer with the
 * same envelope, so the client can treat them uniformly. `sync` is what opts
 * into the envelope: without it every route keeps returning the bare array its
 * existing callers expect, untouched.
 */

export type VoucherSyncParams = {
    /** True when the caller wants the envelope rather than the legacy array. */
    sync: boolean;
    from: Date | null;
    to: Date | null;
    /** Only rows touched after this — absent on a first (full-window) load. */
    since: Date | null;
};

function parseDate(raw: string | null): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function parseVoucherSync(searchParams: URLSearchParams): VoucherSyncParams {
    const to = parseDate(searchParams.get("to"));
    // `to` is a plain date from the client; take the whole of that day, or a
    // voucher written this afternoon drops out of a window ending today.
    if (to) to.setHours(23, 59, 59, 999);
    return {
        sync: searchParams.get("sync") === "1",
        from: parseDate(searchParams.get("from")),
        to,
        since: parseDate(searchParams.get("since")),
    };
}

/** `date` clause for the requested window — omitted entirely when unbounded. */
export function windowWhere({ from, to }: VoucherSyncParams) {
    if (!from && !to) return {};
    return {
        date: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
        },
    };
}

export type SyncEnvelope<T> = {
    /** "delta" carries only what changed; "full" is the whole window. */
    mode: "full" | "delta";
    rows: T[];
    /** Hand back as `since` next time. Captured before the read, so a row
     *  written mid-request is caught by the following delta rather than lost. */
    computedAt: string;
};
