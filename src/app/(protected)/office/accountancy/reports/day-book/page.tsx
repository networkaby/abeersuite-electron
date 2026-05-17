"use client";
// Day Book — chronological view of every voucher across all sources.
// Phase 1: amount-only. Ledger Dr/Cr lines deferred to phase 2.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
    SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { useCombinedVouchers, type CombinedRow } from "@/modules/accountancy/hooks/useCombinedVouchers";
import { indianFiscalYearStart, formatDateInput } from "@/modules/accountancy/lib/period";

// ── Kind configuration ─────────────────────────────────────────────────────

const KIND_BADGE: Record<string, string> = {
    SALE: "bg-emerald-100 text-emerald-700",
    PURCHASE: "bg-blue-100 text-blue-700",
    SALE_RETURN: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200",
    PURCHASE_RETURN: "bg-blue-50 text-blue-600 ring-1 ring-blue-200",
    ESTIMATE: "bg-amber-50 text-amber-600 ring-1 ring-amber-200",
    SALES_ORDER: "bg-teal-100 text-teal-700",
    PURCHASE_ORDER: "bg-cyan-100 text-cyan-700",
    GRN: "bg-cyan-50 text-cyan-600",
    CHALLAN: "bg-indigo-50 text-indigo-600",
    REJECTION_IN: "bg-rose-50 text-rose-600",
    REJECTION_OUT: "bg-rose-100 text-rose-700",
    ISSUE: "bg-orange-50 text-orange-600",
    ADJUSTMENT: "bg-orange-100 text-orange-700",
    STOCK_JOURNAL: "bg-yellow-50 text-yellow-600",
    PHYSICAL_STOCK: "bg-yellow-100 text-yellow-700",
    PAYMENT: "bg-red-50 text-red-700",
    RECEIPT: "bg-violet-100 text-violet-700",
    CONTRA: "bg-slate-100 text-slate-700",
    CREDIT_NOTE: "bg-purple-50 text-purple-700",
    DEBIT_NOTE: "bg-purple-100 text-purple-700",
    JOURNAL: "bg-gray-100 text-gray-700",
};

// These vouchers are operational/documentary — not direct accounting entries.
const OPTIONAL_KINDS = new Set([
    "ESTIMATE", "SALES_ORDER", "PURCHASE_ORDER",
    "GRN", "CHALLAN", "REJECTION_IN", "REJECTION_OUT",
    "STOCK_JOURNAL", "PHYSICAL_STOCK", "ISSUE", "ADJUSTMENT",
]);

// ── Source appearance ──────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<CombinedRow["source"], { label: string; badge: string; accent: string }> = {
    inv: { label: "Inv", badge: "bg-blue-50 text-blue-600", accent: "bg-blue-400" },
    gl: { label: "GL", badge: "bg-violet-50 text-violet-600", accent: "bg-violet-400" },
    je: { label: "JE", badge: "bg-amber-50 text-amber-600", accent: "bg-amber-400" },
};

// ── Kind dropdown ─────────────────────────────────────────────────────────

function matchKind(kind: string, filter: string): boolean {
    switch (filter) {
        case "__all__": return true;
        case "__sale_all__": return kind === "SALE" || kind === "SALE_RETURN";
        case "__buy_all__": return kind === "PURCHASE" || kind === "PURCHASE_RETURN";
        case "__pay_all__": return ["PAYMENT", "RECEIPT", "CONTRA", "CREDIT_NOTE", "DEBIT_NOTE"].includes(kind);
        default: return kind === filter;
    }
}

// ── Page ──────────────────────────────────────────────────────────────────

const today = formatDateInput(new Date());

export default function DayBookPage() {
    const { rows, loading, error, reload } = useCombinedVouchers();

    const [from, setFrom] = useState(formatDateInput(indianFiscalYearStart()));
    const [to, setTo] = useState(today);
    const [search, setSearch] = useState("");
    const [kind, setKind] = useState("__all__");

    // Status checkboxes — empty Set means "show all"
    const [statuses, setStatuses] = useState<Set<string>>(new Set());
    const toggleStatus = (s: string) =>
        setStatuses((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return rows.filter((r) => {
            const d = r.date.slice(0, 10);
            if (from && d < from) return false;
            if (to && d > to) return false;
            if (statuses.size > 0 && !statuses.has(r.status)) return false;
            if (!matchKind(r.kind, kind)) return false;
            if (q && !r.reference.toLowerCase().includes(q)
                && !(r.narration ?? "").toLowerCase().includes(q)
                && !(r.party ?? "").toLowerCase().includes(q)) return false;
            return true;
        });
    }, [rows, from, to, statuses, kind, search]);

    const postedTotal = filtered
        .filter((r) => r.status === "POSTED")
        .reduce((s, r) => s + r.totalAmount, 0);

    return (
        <div className="-m-8 space-y-0">

            {/* Header */}
            {/* <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Day Book</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Every voucher — inventory, GL &amp; journal — sorted by date
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={reload}>Reload</Button>
            </div> */}

            {/* Filters */}
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-t-lg border border-border border-b-0 bg-card p-4">

                {/* Date range */}
                <div className="flex items-end gap-2">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">From</label>
                        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-38" />
                    </div>
                    <span className="pb-1.5 text-muted-foreground text-xs">→</span>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">To</label>
                        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-38" />
                    </div>
                </div>

                {/* Search */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Search</label>
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="ref / party / narration"
                        className="h-8 w-52"
                    />
                </div>

                {/* Kind dropdown */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Voucher kind</label>
                    <Select value={kind} onValueChange={setKind}>
                        <SelectTrigger className="h-8 w-48">
                            <SelectValue placeholder="All kinds" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">All Kinds</SelectItem>
                            <SelectSeparator />
                            <SelectGroup>
                                <SelectLabel>Sales</SelectLabel>
                                <SelectItem value="__sale_all__">All Sale</SelectItem>
                                <SelectItem value="SALE">Sale</SelectItem>
                                <SelectItem value="SALE_RETURN">Sale Return</SelectItem>
                            </SelectGroup>
                            <SelectGroup>
                                <SelectLabel>Purchases</SelectLabel>
                                <SelectItem value="__buy_all__">All Purchase</SelectItem>
                                <SelectItem value="PURCHASE">Purchase</SelectItem>
                                <SelectItem value="PURCHASE_RETURN">Purchase Return</SelectItem>
                            </SelectGroup>
                            <SelectGroup>
                                <SelectLabel>Documents</SelectLabel>
                                <SelectItem value="ESTIMATE">Estimate</SelectItem>
                                <SelectItem value="SALES_ORDER">Sales Order</SelectItem>
                                <SelectItem value="PURCHASE_ORDER">Purchase Order</SelectItem>
                                <SelectItem value="GRN">GRN</SelectItem>
                                <SelectItem value="CHALLAN">Challan</SelectItem>
                                <SelectItem value="REJECTION_IN">Rejection In</SelectItem>
                                <SelectItem value="REJECTION_OUT">Rejection Out</SelectItem>
                            </SelectGroup>
                            <SelectGroup>
                                <SelectLabel>Payments</SelectLabel>
                                <SelectItem value="__pay_all__">All Payment</SelectItem>
                                <SelectItem value="PAYMENT">Payment</SelectItem>
                                <SelectItem value="RECEIPT">Receipt</SelectItem>
                                <SelectItem value="CONTRA">Contra</SelectItem>
                                <SelectItem value="CREDIT_NOTE">Credit Note</SelectItem>
                                <SelectItem value="DEBIT_NOTE">Debit Note</SelectItem>
                            </SelectGroup>
                            <SelectGroup>
                                <SelectLabel>Inventory Ops</SelectLabel>
                                <SelectItem value="ISSUE">Issue</SelectItem>
                                <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
                                <SelectItem value="STOCK_JOURNAL">Stock Journal</SelectItem>
                                <SelectItem value="PHYSICAL_STOCK">Physical Stock</SelectItem>
                            </SelectGroup>
                            <SelectGroup>
                                <SelectLabel>Journal</SelectLabel>
                                <SelectItem value="JOURNAL">Journal</SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>

                {/* Status checkboxes */}
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Status</span>
                    <div className="flex items-center gap-4 h-8">
                        {/* All — checked when no individual filter is active */}
                        <div className="flex items-center gap-1.5">
                            <Checkbox
                                id="status-all"
                                checked={statuses.size === 0}
                                onCheckedChange={() => setStatuses(new Set())}
                            />
                            <Label htmlFor="status-all" className="text-xs cursor-pointer">All</Label>
                        </div>
                        {(["DRAFT", "POSTED", "CANCELLED"] as const).map((s) => (
                            <div key={s} className="flex items-center gap-1.5">
                                <Checkbox
                                    id={`status-${s}`}
                                    checked={statuses.has(s)}
                                    onCheckedChange={() => toggleStatus(s)}
                                />
                                <Label htmlFor={`status-${s}`} className="text-xs cursor-pointer">
                                    {s.charAt(0) + s.slice(1).toLowerCase()}
                                </Label>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Summary */}
                <div className="ml-auto text-right self-end pb-0.5">
                    <div className="text-xs text-muted-foreground">{filtered.length} of {rows.length} rows</div>
                    <div className="text-sm font-mono font-medium">Posted ₹ {fmt(postedTotal)}</div>
                </div>
                <Button variant="outline" size="sm" onClick={reload}>Refresh</Button>
            </div>

            {/* Legend */}
            {/* <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
                {Object.entries(SOURCE_CONFIG).map(([src, cfg]) => (
                    <span key={src} className="flex items-center gap-1.5">
                        <span className={`inline-block w-2.5 h-2.5 rounded-sm ${cfg.accent}`} />
                        {cfg.label === "Inv" ? "Inventory" : cfg.label === "GL" ? "GL Voucher" : "Journal Entry"}
                    </span>
                ))}
                <span className="ml-2 opacity-50">Faded = Draft &nbsp;·&nbsp; <span className="italic">Italic</span> = Optional / non-financial</span>
            </div> */}

            {error && (
                <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-b-lg border border-border bg-card text-center py-16 text-muted-foreground">
                    No vouchers match the current filters.
                </div>
            ) : (
                <div className="overflow-hidden rounded-b-lg border border-border bg-card">
                    <table className="w-full text-sm">
                        <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                            <tr>
                                {/* accent stripe */}
                                <th className="w-1 p-0" />
                                <th className="px-3 py-3 text-left font-medium">Date</th>
                                <th className="px-3 py-3 text-left font-medium">Kind</th>
                                <th className="px-3 py-3 text-left font-medium">Src</th>
                                <th className="px-3 py-3 text-left font-medium">Reference</th>
                                <th className="px-3 py-3 text-left font-medium">Party</th>
                                <th className="px-3 py-3 text-left font-medium">Narration</th>
                                <th className="px-3 py-3 text-right font-medium">Amount</th>
                                <th className="px-3 py-3 text-center font-medium">Status</th>
                                <th className="px-3 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r) => {
                                const src = SOURCE_CONFIG[r.source];
                                const isOpt = OPTIONAL_KINDS.has(r.kind);
                                const isDraft = r.status === "DRAFT";
                                const isCancelled = r.status === "CANCELLED";
                                const isPosted = r.status === "POSTED";

                                return (
                                    <tr
                                        key={r.id}
                                        className={[
                                            "border-b last:border-0 hover:bg-muted/30 transition-opacity",
                                            isDraft ? "opacity-50" : "",
                                            isCancelled ? "opacity-30" : "",
                                            isOpt ? "bg-muted/10" : "",
                                        ].join(" ")}
                                    >
                                        {/* coloured source stripe */}
                                        <td className={`w-1 p-0 ${src.accent}`} />

                                        {/* Date */}
                                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                            {new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                        </td>

                                        {/* Kind badge */}
                                        <td className="px-3 py-2.5">
                                            <span className={[
                                                "text-xs px-2 py-0.5 font-medium rounded-sm",
                                                isOpt ? "ring-1 opacity-80" : "",
                                                KIND_BADGE[r.kind] ?? "bg-muted text-muted-foreground",
                                            ].join(" ")}>
                                                <span className={isOpt ? "italic" : ""}>
                                                    {r.kind.replace(/_/g, " ")}
                                                </span>
                                            </span>
                                        </td>

                                        {/* Source badge */}
                                        <td className="px-3 py-2.5">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${src.badge}`}>
                                                {src.label}
                                            </span>
                                        </td>

                                        {/* Reference */}
                                        <td className={[
                                            "px-3 py-2.5 font-mono text-xs",
                                            isPosted ? "text-foreground font-semibold" : "text-primary",
                                            isCancelled ? "line-through text-muted-foreground" : "",
                                        ].join(" ")}>
                                            {r.reference}
                                        </td>

                                        {/* Party */}
                                        <td className={`px-3 py-2.5 text-sm ${isOpt ? "italic text-muted-foreground" : ""}`}>
                                            {r.party ?? <span className="text-muted-foreground/40">—</span>}
                                        </td>

                                        {/* Narration */}
                                        <td className={[
                                            "px-3 py-2.5 text-xs max-w-[200px] truncate",
                                            isOpt ? "italic text-muted-foreground" : "text-muted-foreground",
                                        ].join(" ")}>
                                            {r.narration ?? "—"}
                                        </td>

                                        {/* Amount */}
                                        <td className={[
                                            "px-3 py-2.5 text-right font-mono text-sm",
                                            isPosted ? "font-semibold text-foreground" : "text-muted-foreground",
                                        ].join(" ")}>
                                            ₹ {fmt(r.totalAmount)}
                                        </td>

                                        {/* Status */}
                                        <td className="px-3 py-2.5 text-center">
                                            <StatusBadge kind="journal" value={r.status} />
                                        </td>

                                        {/* Link */}
                                        <td className="px-3 py-2.5 text-right">
                                            {r.detailHref ? (
                                                <Link href={r.detailHref} className="text-muted-foreground/40 hover:text-primary">
                                                    <ChevronRight size={15} />
                                                </Link>
                                            ) : null}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
