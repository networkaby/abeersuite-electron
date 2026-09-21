// Canonical URL builder for the Group Report explorer.
// Replaces the legacy `/office/accountancy/masters/groups/[id]` detail page —
// the new screen shows the same group with opening / debit / credit / closing
// for a period, so every "click a group to drill in" call site (Balance Sheet,
// P&L, Trial Balance, DrillRow, the ledger explorer's group link) points here.
//
// Balance Sheet only carries a point in time (`asOf`); the explorer works on a
// from–to window, so `asOf` is passed through as the closing date and the
// explorer keeps its own fiscal-year start as `from`.

export function groupReportUrl(
    groupId?: number | null,
    opts?: { from?: string; to?: string; asOf?: string },
): string {
    const params = new URLSearchParams();
    if (groupId) params.set("group", String(groupId));
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to)   params.set("to",   opts.to);
    if (opts?.asOf) params.set("asOf", opts.asOf);
    const q = params.toString();
    return `/office/accountancy/group-report${q ? `?${q}` : ""}`;
}
