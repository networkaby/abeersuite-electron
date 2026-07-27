"use client";
// Unified register that lists every voucher across the three voucher tables
// (InvVoucher / Voucher / JournalEntry).
//
// This is the **canonical surface for soft-deleted vouchers** — the "Deleted"
// status filter opts the user into `includeDeleted=1` on all three list APIs
// and the row menu (DayBookActionsMenu) automatically swaps to Restore +
// Hard Delete for those rows.
//
// All row layout / lifecycle behaviour lives in <VoucherRegisterTable>; this
// page only owns the filter chrome.

import { useMemo, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { fmt } from "@/utils/constants";
import { useCombinedVouchers } from "@/modules/accountancy/hooks/useCombinedVouchers";
import { VoucherRegisterTable } from "@/modules/accountancy/components/VoucherRegisterTable";

type StatusFilter = "" | "DRAFT" | "POSTED" | "CANCELLED" | "DELETED";
const STATUSES: StatusFilter[] = ["", "DRAFT", "POSTED", "CANCELLED", "DELETED"];

export default function AllVouchersPage() {
    const [status, setStatus] = useState<StatusFilter>("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [kindQuery, setKindQuery] = useState("");

    // Fetch with deleted rows included whenever the user picks the Deleted
    // filter — otherwise the three APIs strip them out by default.
    const showDeleted = status === "DELETED";
    const { rows, loading, error, reload } = useCombinedVouchers({ includeDeleted: showDeleted });

    const filtered = useMemo(() => {
        return rows.filter((r) => {
            const isDeleted = !!r.deletedAt;
            if (showDeleted) {
                // "Deleted" filter: only show deleted rows.
                if (!isDeleted) return false;
            } else {
                // Any other filter excludes deleted rows (defence in depth —
                // the API already strips them, but a stale cache could leak).
                if (isDeleted) return false;
                if (status && r.status !== status) return false;
            }
            if (from && r.date < from) return false;
            if (to && r.date > to) return false;
            if (kindQuery && !r.kind.toLowerCase().includes(kindQuery.toLowerCase())) return false;
            return true;
        });
    }, [rows, status, showDeleted, from, to, kindQuery]);

    const totalDebit = filtered
        .filter((r) => r.status === "POSTED" && !r.deletedAt)
        .reduce((s, r) => s + r.totalAmount, 0);

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
                            Combined register across inventory, GL, and journal entries — sorted by date
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
                                            ? (s === "DELETED"
                                                ? "border-rose-600 bg-rose-600 text-white"
                                                : "border-primary bg-primary text-primary-foreground")
                                            : "border-border bg-card text-muted-foreground hover:bg-muted"
                                        }`}
                                >
                                    {s || "All"}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <div className="ml-auto text-right">
                        <div className="text-xs text-muted-foreground">{filtered.length} of {rows.length} rows</div>
                        <div className="text-sm font-mono">Posted total ₹ {fmt(totalDebit)}</div>
                    </div>
                </div>

                {error && (
                    <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                )}

                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="animate-spin text-muted-foreground" size={28} />
                    </div>
                ) : (
                    <VoucherRegisterTable
                        rows={filtered}
                        showSource
                        onChanged={reload}
                        emptyMessage={
                            showDeleted
                                ? "No deleted vouchers."
                                : "No vouchers match the current filters."
                        }
                    />
                )}
            </div>
        </ScrollArea>
    );
}
