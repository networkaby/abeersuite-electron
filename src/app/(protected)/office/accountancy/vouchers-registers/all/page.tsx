"use client";
// Unified register that lists every voucher on the universal-voucher spine.
//
// All row layout / lifecycle behaviour lives in <VoucherRegisterTable>; this
// page only owns the filter chrome. Rows come from the same paginated Day Book
// endpoint, so this page pages the same way — 50 at a time, newest first.

import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { fmt } from "@/utils/constants";
import { useDayBook } from "@/modules/accountancy/hooks/useDayBook";
import { presetRange } from "@/modules/accountancy/hooks/useRegisterFilters";
import { VoucherRegisterTable } from "@/modules/accountancy/components/VoucherRegisterTable";

type StatusFilter = "" | "DRAFT" | "POSTED" | "CANCELLED";
const STATUSES: StatusFilter[] = ["", "DRAFT", "POSTED", "CANCELLED"];

export default function AllVouchersPage() {
    const [status, setStatus] = useState<StatusFilter>("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [kindQuery, setKindQuery] = useState("");

    // An empty date box means "this FY" — the outer boundary, not a download.
    const fyRange = useMemo(() => presetRange("thisFY"), []);
    const query = useMemo(() => ({
        from:     from || fyRange.from,
        to:       to   || fyRange.to,
        statuses: status ? [status] : [],
    }), [from, to, status, fyRange]);

    const { rows, loading, loadingMore, hasMore, error, loadMore, reload } = useDayBook(query);

    // Kind here is a free-text "contains" rather than the Day Book's exact-kind
    // dropdown, so it stays a filter over the rows already pulled. Fine for a
    // testing surface; the Day Book is the one that has to be exact.
    const filtered = useMemo(
        () => (kindQuery
            ? rows.filter((r) => r.kind.toLowerCase().includes(kindQuery.toLowerCase()))
            : rows),
        [rows, kindQuery],
    );

    const totalDebit = filtered
        .filter((r) => r.status === "POSTED")
        .reduce((s, r) => s + r.totalAmount, 0);

    const sentinelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore) return;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) loadMore();
        }, { rootMargin: "200px" });
        io.observe(node);
        return () => io.disconnect();
    }, [hasMore, loadMore, rows.length]);

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-7xl mx-auto space-y-6 px-0 pt-3 pb-6">
                {/* Dev-only banner — this page is not linked from the nav in production.
                Use Day Book (/office/accountancy/reports/day-book) as the production surface. */}
                <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    <FlaskConical size={15} className="shrink-0" />
                    <span><strong>Testing only</strong> — this page is not linked from the nav. Use <strong>Day Book</strong> for the production combined-voucher view.</span>
                </div>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">All Vouchers</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Every voucher on the spine — inventory, GL, and journals — sorted by date
                        </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={reload}>Reload</Button>
                </div>

                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">From</label>
                        <TallyDateInput value={from} onValueChange={setFrom} className="h-8 w-40" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">To</label>
                        <TallyDateInput value={to} onValueChange={setTo} monthMode="end" className="h-8 w-40" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">Kind contains</label>
                        <Input value={kindQuery} onChange={(e) => setKindQuery(e.target.value)} placeholder="e.g. sale, payment" className="h-8 w-44" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">Status</label>
                        <div className="flex gap-1">
                            {STATUSES.map((s) => (
                                <Button
                                    key={s}
                                    variant="outline"
                                    size="xs"
                                    onClick={() => setStatus(s)}
                                    className={`h-8 px-3 text-xs font-medium ${status === s
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : "border-border bg-card text-muted-foreground hover:bg-muted"
                                        }`}
                                >
                                    {s || "All"}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <div className="ml-auto text-right">
                        <div className="text-xs text-muted-foreground">
                            {filtered.length} row{filtered.length === 1 ? "" : "s"}{hasMore ? " so far" : ""}
                        </div>
                        <div className="text-sm font-mono" title="Covers the rows loaded so far, not the whole period">
                            Posted (loaded) ₹ {fmt(totalDebit)}
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                )}

                {loading && rows.length === 0 ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="animate-spin text-muted-foreground" size={28} />
                    </div>
                ) : (
                    <>
                        <VoucherRegisterTable
                            rows={filtered}
                            showSource
                            showSettlement
                            onChanged={reload}
                            emptyMessage="No vouchers match the current filters."
                        />
                        {hasMore && (
                            <div ref={sentinelRef} className="flex justify-center py-6">
                                {loadingMore
                                    ? <Loader2 className="animate-spin text-muted-foreground" size={20} />
                                    : <Button variant="outline" size="sm" onClick={loadMore}>Load more</Button>}
                            </div>
                        )}
                    </>
                )}
            </div>
        </ScrollArea>
    );
}
