"use client";
// Unified register that lists every voucher across the three voucher tables
// (InvVoucher / Voucher / JournalEntry). Filters are client-side — see
// useCombinedVouchers for the limits.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmt } from "@/utils/constants";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { useCombinedVouchers, type CombinedRow } from "@/modules/accountancy/hooks/useCombinedVouchers";

const KIND_BADGE: Record<string, string> = {
    SALE:            "bg-emerald-100 text-emerald-700",
    PURCHASE:        "bg-blue-100 text-blue-700",
    SALE_RETURN:     "bg-emerald-50 text-emerald-700",
    PURCHASE_RETURN: "bg-blue-50 text-blue-700",
    ESTIMATE:        "bg-amber-100 text-amber-700",
    SALES_ORDER:     "bg-teal-100 text-teal-700",
    PURCHASE_ORDER:  "bg-cyan-100 text-cyan-700",
    GRN:             "bg-cyan-50 text-cyan-700",
    CHALLAN:         "bg-indigo-50 text-indigo-700",
    REJECTION_IN:    "bg-rose-50 text-rose-700",
    REJECTION_OUT:   "bg-rose-100 text-rose-700",
    RECEIPT:         "bg-violet-100 text-violet-700",
    ISSUE:           "bg-orange-50 text-orange-700",
    ADJUSTMENT:      "bg-orange-100 text-orange-700",
    STOCK_JOURNAL:   "bg-yellow-50 text-yellow-700",
    PHYSICAL_STOCK:  "bg-yellow-100 text-yellow-700",
    PAYMENT:         "bg-red-50 text-red-700",
    CONTRA:          "bg-slate-100 text-slate-700",
    CREDIT_NOTE:     "bg-purple-50 text-purple-700",
    DEBIT_NOTE:      "bg-purple-100 text-purple-700",
    JOURNAL:         "bg-gray-100 text-gray-700",
};

const SOURCE_LABEL: Record<CombinedRow["source"], string> = {
    inv: "Inventory",
    gl:  "GL",
    je:  "Journal",
};

const STATUSES = ["", "DRAFT", "POSTED", "CANCELLED"] as const;

export default function AllVouchersPage() {
    const { rows, loading, error, reload } = useCombinedVouchers();
    const [status, setStatus] = useState<(typeof STATUSES)[number]>("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [kindQuery, setKindQuery] = useState("");

    const filtered = useMemo(() => {
        return rows.filter((r) => {
            if (status && r.status !== status) return false;
            if (from && r.date < from) return false;
            if (to && r.date > to) return false;
            if (kindQuery && !r.kind.toLowerCase().includes(kindQuery.toLowerCase())) return false;
            return true;
        });
    }, [rows, status, from, to, kindQuery]);

    const totalDebit = filtered
        .filter((r) => r.status === "POSTED")
        .reduce((s, r) => s + r.totalAmount, 0);

    return (
        <div className="max-w-7xl mx-auto space-y-6">
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
                    <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">To</label>
                    <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Kind contains</label>
                    <Input value={kindQuery} onChange={(e) => setKindQuery(e.target.value)} placeholder="e.g. sale, payment" className="h-8 w-44" />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                    <div className="flex gap-1">
                        {STATUSES.map((s) => (
                            <Button key={s} variant="outline" size="xs"
                                onClick={() => setStatus(s)}
                                className={`h-8 px-3 text-xs font-medium ${status === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
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
            ) : filtered.length === 0 ? (
                <div className="rounded-lg border border-border bg-card text-center py-16 text-muted-foreground">
                    No vouchers match the current filters.
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                    <table className="w-full text-sm">
                        <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium">Kind</th>
                                <th className="px-4 py-3 text-left font-medium">Source</th>
                                <th className="px-4 py-3 text-left font-medium">Reference</th>
                                <th className="px-4 py-3 text-left font-medium">Date</th>
                                <th className="px-4 py-3 text-left font-medium">Party</th>
                                <th className="px-4 py-3 text-left font-medium">Narration</th>
                                <th className="px-4 py-3 text-right font-medium">Amount</th>
                                <th className="px-4 py-3 text-center font-medium">Status</th>
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r) => (
                                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-0.5 font-medium rounded-sm ${KIND_BADGE[r.kind] ?? "bg-muted text-muted-foreground"}`}>
                                            {r.kind.replace(/_/g, " ")}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-muted-foreground">{SOURCE_LABEL[r.source]}</td>
                                    <td className="px-4 py-3 font-mono text-primary text-xs">{r.reference}</td>
                                    <td className="px-4 py-3 text-muted-foreground text-xs">
                                        {new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                    </td>
                                    <td className="px-4 py-3">{r.party ?? <span className="text-muted-foreground/50">—</span>}</td>
                                    <td className="px-4 py-3 text-muted-foreground max-w-[220px] truncate">{r.narration ?? "—"}</td>
                                    <td className="px-4 py-3 text-right font-mono">₹ {fmt(r.totalAmount)}</td>
                                    <td className="px-4 py-3 text-center"><StatusBadge kind="journal" value={r.status} /></td>
                                    <td className="px-4 py-3 text-right">
                                        {r.detailHref ? (
                                            <Link href={r.detailHref} className="text-muted-foreground/40 hover:text-primary">
                                                <ChevronRight size={16} />
                                            </Link>
                                        ) : null}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
