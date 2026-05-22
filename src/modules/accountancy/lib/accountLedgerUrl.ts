// Canonical URL builder for the new master-detail account-ledger explorer.
// Replaces the legacy `/office/accountancy/account/[id]` single-page ledger.
// Used by every "click a ledger to drill in" call site (Trial Balance,
// P&L, Balance Sheet, Cash Book, Bank Book, …) so a future URL rename or
// query-param change lands in one file.
//
// The explorer (AccountLedgerExplorer) currently reads only `accountId`;
// `from`/`to`/`asOf` are accepted here for forward-compat so the period
// can flow through the drill once the explorer is taught to honour them.

export function accountLedgerUrl(
    accountId: number,
    opts?: { from?: string; to?: string; asOf?: string },
): string {
    const params = new URLSearchParams({ accountId: String(accountId) });
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to)   params.set("to",   opts.to);
    if (opts?.asOf) params.set("asOf", opts.asOf);
    return `/office/accountancy/account-ledgers?${params.toString()}`;
}
