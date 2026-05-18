"use client";
// Day Book — chronological view of every voucher across all sources.

import React, { useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
    SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt, JOURNAL_STATUS_COLORS } from "@/utils/constants";
import { useCombinedVouchers, type CombinedRow } from "@/modules/accountancy/hooks/useCombinedVouchers";
import { indianFiscalYearStart, formatDateInput } from "@/modules/accountancy/lib/period";
import { DayBookActionsMenu } from "@/modules/accountancy/components/DayBookActionsMenu";
import { referenceHref } from "@/modules/accountancy/lib/voucherUrls";

// ── Expand line types ─────────────────────────────────────────────────────
// GL and JE lines have an 'account' field; inventory lines have a 'product'.

type GlLine = {
    account: { id?: number; code: string; name: string; normalBalance?: string };
    type: "DEBIT" | "CREDIT";
    amount: number;
};
type InvLine = {
    product: { id: number; sku: string; name: string; unit?: { code: string; label: string } | null };
    quantity: number;
    rate: number;
    amount: number;
};
type Line = GlLine | InvLine;

// ── Date preset helpers ───────────────────────────────────────────────────

type DatePreset = "today" | "yesterday" | "last7" | "thisMonth" | "thisFY" | "custom";

function presetRange(p: DatePreset): { from: string; to: string } {
    const t = new Date();
    const f = (d: Date) => formatDateInput(d);
    switch (p) {
        case "today":     return { from: f(t), to: f(t) };
        case "yesterday": { const d = new Date(t); d.setDate(d.getDate() - 1); return { from: f(d), to: f(d) }; }
        case "last7":     { const d = new Date(t); d.setDate(d.getDate() - 6); return { from: f(d), to: f(t) }; }
        case "thisMonth": return { from: f(new Date(t.getFullYear(), t.getMonth(), 1)), to: f(t) };
        case "thisFY":    return { from: formatDateInput(indianFiscalYearStart()), to: f(t) };
        default:          return { from: "", to: "" };
    }
}

// ── Kind configuration ─────────────────────────────────────────────────────

const KIND_BADGE: Record<string, string> = {
    SALE: "bg-emerald-100 text-emerald-700",
    POS: "bg-emerald-200 text-emerald-800",
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
    MANUFACTURING_JOURNAL: "bg-yellow-50 text-yellow-600",
    PHYSICAL_STOCK: "bg-yellow-100 text-yellow-700",
    BRANCH_TRANSFER: "bg-sky-100 text-sky-700",
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
    "MANUFACTURING_JOURNAL", "PHYSICAL_STOCK", "BRANCH_TRANSFER", "ISSUE", "ADJUSTMENT",
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
        case "__sale_all__": return kind === "SALE" || kind === "POS" || kind === "SALE_RETURN";
        case "__buy_all__": return kind === "PURCHASE" || kind === "PURCHASE_RETURN";
        case "__pay_all__": return ["PAYMENT", "RECEIPT", "CONTRA", "CREDIT_NOTE", "DEBIT_NOTE"].includes(kind);
        default: return kind === filter;
    }
}

// ── Page ──────────────────────────────────────────────────────────────────

const today = formatDateInput(new Date());

export default function DayBookPage() {
    const { rows, loading, error, reload } = useCombinedVouchers();

    const [preset, setPreset] = useState<DatePreset>("today");
    const [from,   setFrom]   = useState(presetRange("today").from);
    const [to,     setTo]     = useState(presetRange("today").to);

    const applyPreset = (p: DatePreset) => {
        setPreset(p);
        if (p !== "custom") { const r = presetRange(p); setFrom(r.from); setTo(r.to); }
    };
    const handleFrom = (v: string) => { setFrom(v); setPreset("custom"); };
    const handleTo   = (v: string) => { setTo(v);   setPreset("custom"); };
    const [search,       setSearch]       = useState("");
    const [kind,         setKind]         = useState("__all__");
    const [optionalOnly, setOptionalOnly] = useState(false);
    const [inventoryOnly,setInventoryOnly]= useState(false);

    // Status checkboxes — empty Set means "show all"
    const [statuses, setStatuses] = useState<Set<string>>(new Set());
    const toggleStatus = (s: string) =>
        setStatuses((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

    // Expand state: which row ids are open + lazy-fetched line cache (keyed by CombinedRow.id)
    const [expanded,  setExpanded]  = useState<Set<string>>(new Set());
    const [lineCache, setLineCache] = useState<Map<string, Line[] | "loading" | "error">>(new Map());

    const toggleExpand = (r: CombinedRow) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(r.id)) {
                next.delete(r.id);
            } else {
                next.add(r.id);
                // Lazy-fetch on first open only
                if (!lineCache.has(r.id)) {
                    setLineCache((c) => new Map(c).set(r.id, "loading"));
                    const url =
                        r.source === "inv" ? `/api/inventory/vouchers/${r.rawId}` :
                        r.source === "gl"  ? `/api/accountancy/vouchers/${r.rawId}` :
                                              `/api/accountancy/journal-entries/${r.rawId}`;
                    axios.get<{ lines: Line[] }>(url)
                        .then((res) => setLineCache((c) => new Map(c).set(r.id, res.data.lines ?? [])))
                        .catch(() => setLineCache((c) => new Map(c).set(r.id, "error")));
                }
            }
            return next;
        });
    };

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        // Optional = no direct stock/GL impact (documents/orders)
        const OPT_SET = new Set(["ESTIMATE","SALES_ORDER","PURCHASE_ORDER","CHALLAN"]);
        // Inventory-only = pure stock ops
        const INV_SET = new Set(["PHYSICAL_STOCK","MANUFACTURING_JOURNAL","BRANCH_TRANSFER","ISSUE","ADJUSTMENT","GRN","REJECTION_IN","REJECTION_OUT"]);
        return rows.filter((r) => {
            const d = r.date.slice(0, 10);
            if (from && d < from) return false;
            if (to   && d > to)   return false;
            if (statuses.size > 0 && !statuses.has(r.status)) return false;
            if (!matchKind(r.kind, kind)) return false;
            if (optionalOnly || inventoryOnly) {
                const isOpt = optionalOnly && OPT_SET.has(r.kind);
                const isInv = inventoryOnly && INV_SET.has(r.kind);
                if (!isOpt && !isInv) return false;
            }
            if (q && !r.reference.toLowerCase().includes(q)
                  && !(r.narration ?? "").toLowerCase().includes(q)
                  && !(r.party     ?? "").toLowerCase().includes(q)) return false;
            return true;
        });
    }, [rows, from, to, statuses, kind, search, optionalOnly, inventoryOnly]);

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

                {/* Date preset + custom range */}
                <div className="flex items-end gap-2">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">Period</label>
                        <Select value={preset} onValueChange={(v) => applyPreset(v as DatePreset)}>
                            <SelectTrigger className="h-8 w-36">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="today">Today</SelectItem>
                                <SelectItem value="yesterday">Yesterday</SelectItem>
                                <SelectItem value="last7">Last 7 days</SelectItem>
                                <SelectItem value="thisMonth">This month</SelectItem>
                                <SelectItem value="thisFY">This FY</SelectItem>
                                <SelectItem value="custom">Custom</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">From</label>
                        <Input type="date" value={from} onChange={(e) => handleFrom(e.target.value)} className="h-8 w-36" />
                    </div>
                    <span className="pb-1.5 text-muted-foreground text-xs">→</span>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">To</label>
                        <Input type="date" value={to} onChange={(e) => handleTo(e.target.value)} className="h-8 w-36" />
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
                                <SelectItem value="POS">POS</SelectItem>
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
                                <SelectItem value="MANUFACTURING_JOURNAL">Manufacturing Journal</SelectItem>
                                <SelectItem value="BRANCH_TRANSFER">Branch Transfer</SelectItem>
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

                {/* Category quick-filters */}
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Category</span>
                    <div className="flex items-center gap-4 h-8">
                        <div className="flex items-center gap-1.5">
                            <Checkbox
                                id="cat-optional"
                                checked={optionalOnly}
                                onCheckedChange={(v) => { setOptionalOnly(!!v); if (v) setInventoryOnly(false); }}
                            />
                            <Label htmlFor="cat-optional" className="text-xs cursor-pointer italic">Optional only</Label>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Checkbox
                                id="cat-inventory"
                                checked={inventoryOnly}
                                onCheckedChange={(v) => { setInventoryOnly(!!v); if (v) setOptionalOnly(false); }}
                            />
                            <Label htmlFor="cat-inventory" className="text-xs cursor-pointer">Inventory only</Label>
                        </div>
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
                                {/* accent stripe — no header */}
                                <th className="w-1 p-0" />
                                <th className="px-3 py-3 text-left font-medium">Date</th>
                                <th className="px-3 py-3 text-left font-medium">Type</th>
                                <th className="px-3 py-3 text-left font-medium">Reference</th>
                                <th className="px-3 py-3 text-left font-medium">Party</th>
                                <th className="px-3 py-3 text-left font-medium">Narration</th>
                                <th className="px-3 py-3 text-right font-medium">Total</th>
                                {/* actions — no header */}
                                <th className="w-10 p-0" />
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r) => {
                                const src = SOURCE_CONFIG[r.source];
                                const isOpt = OPTIONAL_KINDS.has(r.kind);
                                const isDraft = r.status === "DRAFT";
                                const isCancelled = r.status === "CANCELLED";
                                const isPosted = r.status === "POSTED";
                                const isExpanded = expanded.has(r.id);
                                const lines = lineCache.get(r.id);
                                const href = referenceHref(r.source, r.rawId, r.kind);

                                return (
                                    <React.Fragment key={r.id}>
                                        {/* ── Main row ─────────────────────────────── */}
                                        <tr
                                            className={[
                                                "border-b last:border-0 hover:bg-muted/40 transition-opacity cursor-pointer",
                                                isDraft ? "opacity-50" : "",
                                                isCancelled ? "opacity-30" : "",
                                                isOpt ? "bg-muted/10" : "",
                                            ].join(" ")}
                                            title="Click row to expand Dr/Cr lines · Click the reference to edit"
                                            onClick={() => toggleExpand(r)}
                                        >
                                            {/* Coloured source stripe */}
                                            <td className={`w-1 p-0 ${src.accent}`} />

                                            {/* Date */}
                                            <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                                {new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                            </td>

                                            {/* Type badge + status pill */}
                                            <td className="px-3 py-2.5">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={[
                                                        "text-xs px-2 py-0.5 font-medium rounded-sm",
                                                        isOpt ? "ring-1 opacity-80" : "",
                                                        KIND_BADGE[r.kind] ?? "bg-muted text-muted-foreground",
                                                    ].join(" ")}>
                                                        <span className={isOpt ? "italic" : ""}>
                                                            {r.kind.replace(/_/g, " ")}
                                                        </span>
                                                    </span>
                                                    {!isPosted && (
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${JOURNAL_STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground"}`}>
                                                            {r.status.toLowerCase()}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Reference — clickable edit link */}
                                            <td
                                                className={[
                                                    "px-3 py-2.5 font-mono text-xs",
                                                    isPosted ? "text-foreground font-semibold" : "text-primary",
                                                    isCancelled ? "line-through text-muted-foreground" : "",
                                                ].join(" ")}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {href ? (
                                                    <Link href={href} className="hover:underline underline-offset-2">
                                                        {r.reference}
                                                    </Link>
                                                ) : (
                                                    r.reference
                                                )}
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

                                            {/* Total */}
                                            <td className={[
                                                "px-3 py-2.5 text-right font-mono text-sm",
                                                isPosted ? "font-semibold text-foreground" : "text-muted-foreground",
                                            ].join(" ")}>
                                                ₹ {fmt(r.totalAmount)}
                                            </td>

                                            {/* 3-dot actions menu */}
                                            <td
                                                className="px-2 py-2.5 text-right"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <DayBookActionsMenu
                                                    rawId={r.rawId}
                                                    source={r.source}
                                                    kind={r.kind}
                                                    reference={r.reference}
                                                    deletedAt={r.deletedAt}
                                                    onChanged={reload}
                                                />
                                            </td>
                                        </tr>

                                        {/* ── Expand rows: one <tr> per Dr/Cr line ─── */}
                                        {isExpanded && lines === "loading" && (
                                            <tr className="bg-muted/20 border-b last:border-0">
                                                <td colSpan={8} className="px-6 py-2 text-xs text-muted-foreground">
                                                    <Loader2 className="animate-spin size-3 inline mr-1.5" />
                                                    Loading lines…
                                                </td>
                                            </tr>
                                        )}
                                        {isExpanded && lines === "error" && (
                                            <tr className="bg-muted/20 border-b last:border-0">
                                                <td colSpan={8} className="px-6 py-2 text-xs text-destructive">
                                                    Failed to load lines.
                                                </td>
                                            </tr>
                                        )}
                                        {isExpanded && Array.isArray(lines) && lines.length === 0 && (
                                            <tr className="bg-muted/20 border-b last:border-0">
                                                <td colSpan={8} className="px-6 py-2 text-xs text-muted-foreground">
                                                    No lines found.
                                                </td>
                                            </tr>
                                        )}
                                        {isExpanded && Array.isArray(lines) && lines.map((l, i) => {
                                            const isGl = "account" in l;
                                            return (
                                                <tr key={`${r.id}-line-${i}`} className="bg-muted/20 border-b last:border-0">
                                                    {/* accent stripe — faded parent colour */}
                                                    <td className={`w-1 p-0 ${src.accent} opacity-30`} />
                                                    {/* Date col — blank */}
                                                    <td />
                                                    {/* Type col — Dr/Cr badge (GL) or "item" badge (inv) */}
                                                    <td className="px-3 py-1">
                                                        {isGl ? (
                                                            <span className={[
                                                                "text-[10px] px-1.5 py-0.5 rounded font-semibold",
                                                                l.type === "DEBIT"
                                                                    ? "bg-blue-50 text-blue-600"
                                                                    : "bg-violet-50 text-violet-600",
                                                            ].join(" ")}>
                                                                {l.type === "DEBIT" ? "Dr" : "Cr"}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-muted text-muted-foreground">
                                                                item
                                                            </span>
                                                        )}
                                                    </td>
                                                    {/* Reference col — account code (GL) or product SKU (inv) */}
                                                    <td className="px-3 py-1 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                                                        {isGl ? l.account.code : l.product.sku}
                                                    </td>
                                                    {/* Party + Narration cols */}
                                                    {isGl ? (
                                                        <td colSpan={2} className="px-3 py-1 text-xs text-foreground">
                                                            {l.account.name}
                                                        </td>
                                                    ) : (
                                                        <>
                                                            <td className="px-3 py-1 text-xs text-foreground">{l.product.name}</td>
                                                            <td className="px-3 py-1 text-xs text-muted-foreground font-mono">
                                                                {l.quantity} × ₹{fmt(Number(l.rate))}
                                                            </td>
                                                        </>
                                                    )}
                                                    {/* Total col */}
                                                    <td className="px-3 py-1 text-right font-mono text-xs tabular-nums text-muted-foreground">
                                                        ₹ {fmt(Number(l.amount))}
                                                    </td>
                                                    {/* Actions col — blank */}
                                                    <td />
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
