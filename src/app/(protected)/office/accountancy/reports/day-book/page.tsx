"use client";
// Day Book — chronological view of every voucher across all sources.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { ArrowLeft, ExternalLink, Loader2, X } from "lucide-react";
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

    const [preset, setPreset] = useState<DatePreset>(() => {
        try { return (localStorage.getItem("daybook:preset") as DatePreset) ?? "today"; }
        catch { return "today"; }
    });
    const [from, setFrom] = useState(() => {
        try {
            const p = (localStorage.getItem("daybook:preset") as DatePreset) ?? "today";
            return p === "custom"
                ? (localStorage.getItem("daybook:from") ?? presetRange("today").from)
                : presetRange(p).from;
        } catch { return presetRange("today").from; }
    });
    const [to, setTo] = useState(() => {
        try {
            const p = (localStorage.getItem("daybook:preset") as DatePreset) ?? "today";
            return p === "custom"
                ? (localStorage.getItem("daybook:to") ?? presetRange("today").to)
                : presetRange(p).to;
        } catch { return presetRange("today").to; }
    });

    const applyPreset = (p: DatePreset) => {
        setPreset(p);
        if (p !== "custom") { const r = presetRange(p); setFrom(r.from); setTo(r.to); }
    };
    const handleFrom = (v: string) => { setFrom(v); setPreset("custom"); };
    const handleTo   = (v: string) => { setTo(v);   setPreset("custom"); };
    const [search, setSearch] = useState("");
    const [kind, setKind] = useState(() => {
        try { return localStorage.getItem("daybook:kind") ?? "__all__"; }
        catch { return "__all__"; }
    });
    const [optionalOnly, setOptionalOnly] = useState(() => {
        try { return localStorage.getItem("daybook:optionalOnly") === "true"; }
        catch { return false; }
    });
    const [inventoryOnly, setInventoryOnly] = useState(() => {
        try { return localStorage.getItem("daybook:inventoryOnly") === "true"; }
        catch { return false; }
    });

    // Status checkboxes — empty Set means "show all"
    const [statuses, setStatuses] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem("daybook:statuses");
            return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
        } catch { return new Set(); }
    });
    const toggleStatus = (s: string) =>
        setStatuses((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

    // Persist filter state to localStorage
    useEffect(() => { try { localStorage.setItem("daybook:preset", preset); } catch {} }, [preset]);
    useEffect(() => { try { localStorage.setItem("daybook:from",   from);   } catch {} }, [from]);
    useEffect(() => { try { localStorage.setItem("daybook:to",     to);     } catch {} }, [to]);
    useEffect(() => { try { localStorage.setItem("daybook:kind",   kind);   } catch {} }, [kind]);
    useEffect(() => { try { localStorage.setItem("daybook:statuses", JSON.stringify([...statuses])); } catch {} }, [statuses]);
    useEffect(() => { try { localStorage.setItem("daybook:optionalOnly",  String(optionalOnly));  } catch {} }, [optionalOnly]);
    useEffect(() => { try { localStorage.setItem("daybook:inventoryOnly", String(inventoryOnly)); } catch {} }, [inventoryOnly]);

    // Expand state: which row ids are open + lazy-fetched line cache (keyed by CombinedRow.id)
    const [expanded,  setExpanded]  = useState<Set<string>>(new Set());
    const [lineCache, setLineCache] = useState<Map<string, Line[] | "loading" | "error">>(new Map());
    const [selectedRow, setSelectedRow] = useState<CombinedRow | null>(null);

    const router = useRouter();

    const fetchLines = (r: CombinedRow) => {
        if (lineCache.has(r.id)) return;
        setLineCache((c) => new Map(c).set(r.id, "loading"));
        const url =
            r.source === "inv" ? `/api/inventory/vouchers/${r.rawId}` :
            r.source === "gl"  ? `/api/accountancy/vouchers/${r.rawId}` :
                                  `/api/accountancy/journal-entries/${r.rawId}`;
        axios.get<{ lines: Line[] }>(url)
            .then((res) => setLineCache((c) => new Map(c).set(r.id, res.data.lines ?? [])))
            .catch(() => setLineCache((c) => new Map(c).set(r.id, "error")));
    };

    const toggleExpand = (r: CombinedRow) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(r.id)) { next.delete(r.id); } else { next.add(r.id); fetchLines(r); }
            return next;
        });
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (document.querySelector('[data-state="open"][role="dialog"]')) return;
            if (selectedRow !== null) setSelectedRow(null);
            else router.back();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [router, selectedRow]);

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

    const panelLines = selectedRow ? lineCache.get(selectedRow.id) : undefined;

    return (
        <div className="-m-8 flex h-screen flex-col overflow-hidden">

            {/* Breadcrumb */}
            <header className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => router.back()} title="Back (Esc)">
                    <ArrowLeft size={15} />
                </Button>
                <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Link href="/office/accountancy" className="transition-colors hover:text-foreground">Accountancy</Link>
                    <span>/</span>
                    <Link href="/office/accountancy/reports" className="transition-colors hover:text-foreground">Reports</Link>
                    <span>/</span>
                    <span className="font-medium text-foreground">Day Book</span>
                </nav>
            </header>

            {/* Filters */}
            <div className="flex shrink-0 flex-wrap items-end gap-x-4 gap-y-3 border-b bg-card p-4">

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

            {/* Table + detail panel */}
            <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto">

            {error && (
                <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-card py-16 text-center text-muted-foreground">
                    No vouchers match the current filters.
                </div>
            ) : (
                <div className="overflow-hidden bg-card">
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

                                            {/* Reference — left-click opens panel; right/ctrl/cmd opens full page */}
                                            <td
                                                className={[
                                                    "px-3 py-2.5 font-mono text-xs",
                                                    isPosted ? "text-foreground font-semibold" : "text-primary",
                                                    isCancelled ? "line-through text-muted-foreground" : "",
                                                ].join(" ")}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {href ? (
                                                    <Link
                                                        href={href}
                                                        className="hover:underline underline-offset-2"
                                                        onClick={(e) => {
                                                            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                                                            e.preventDefault();
                                                            setSelectedRow(r);
                                                            fetchLines(r);
                                                        }}
                                                    >
                                                        {r.reference}
                                                    </Link>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="hover:underline underline-offset-2"
                                                        onClick={() => { setSelectedRow(r); fetchLines(r); }}
                                                    >
                                                        {r.reference}
                                                    </button>
                                                )}
                                            </td>

                                            {/* Party — clickable link to All Customers with this row pre-selected */}
                                            <td
                                                className={`px-3 py-2.5 text-sm ${isOpt ? "italic text-muted-foreground" : ""}`}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {r.party
                                                    ? (r.partyKind && r.partyEntityId
                                                        ? <Link
                                                              href={`/office/customers/all?${r.partyKind}Id=${r.partyEntityId}`}
                                                              className="text-primary hover:underline underline-offset-2"
                                                          >
                                                              {r.party}
                                                          </Link>
                                                        : r.party)
                                                    : <span className="text-muted-foreground/40">—</span>}
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
            </div>{/* end scrollable table column */}

            {/* Detail panel */}
            {selectedRow && (
                <aside className="w-[420px] shrink-0 overflow-y-auto border-l bg-card">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${KIND_BADGE[selectedRow.kind] ?? "bg-muted text-muted-foreground"}`}>
                                    {selectedRow.kind.replace(/_/g, " ")}
                                </span>
                                <span className={`font-mono text-sm font-semibold ${selectedRow.status === "CANCELLED" ? "line-through text-muted-foreground" : ""}`}>
                                    {selectedRow.reference}
                                </span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{new Date(selectedRow.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                                {selectedRow.status !== "POSTED" && (
                                    <span className={`rounded px-1.5 py-0.5 font-medium ${JOURNAL_STATUS_COLORS[selectedRow.status] ?? "bg-muted text-muted-foreground"}`}>
                                        {selectedRow.status.toLowerCase()}
                                    </span>
                                )}
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_CONFIG[selectedRow.source].badge}`}>
                                    {SOURCE_CONFIG[selectedRow.source].label}
                                </span>
                            </div>
                        </div>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSelectedRow(null)} title="Close (Esc)">
                            <X size={14} />
                        </Button>
                    </div>

                    {/* Meta */}
                    <div className="space-y-1.5 border-b px-4 py-3">
                        {selectedRow.party && (
                            <p className="text-xs">
                                <span className="text-muted-foreground">Party — </span>
                                <span className="font-medium">{selectedRow.party}</span>
                            </p>
                        )}
                        {selectedRow.narration && (
                            <p className="text-xs text-muted-foreground">{selectedRow.narration}</p>
                        )}
                        <p className="font-mono text-lg font-semibold">₹ {fmt(selectedRow.totalAmount)}</p>
                        {referenceHref(selectedRow.source, selectedRow.rawId, selectedRow.kind) && (
                            <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                                <Link href={referenceHref(selectedRow.source, selectedRow.rawId, selectedRow.kind)!}>
                                    <ExternalLink size={12} className="mr-1.5" />
                                    Open full page
                                </Link>
                            </Button>
                        )}
                    </div>

                    {/* Lines */}
                    <div className="px-4 py-3">
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Lines</p>
                        {(!panelLines || panelLines === "loading") && (
                            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                                <Loader2 size={14} className="animate-spin" /> Loading…
                            </div>
                        )}
                        {panelLines === "error" && (
                            <p className="py-4 text-xs text-destructive">Failed to load lines.</p>
                        )}
                        {Array.isArray(panelLines) && panelLines.length === 0 && (
                            <p className="py-4 text-xs text-muted-foreground">No lines found.</p>
                        )}
                        {Array.isArray(panelLines) && panelLines.length > 0 && (
                            <div className="space-y-1">
                                {panelLines.map((l, i) => {
                                    const isGl = "account" in l;
                                    return (
                                        <div key={i} className="flex items-center gap-2 rounded-sm bg-muted/40 px-2 py-1.5 text-xs">
                                            {isGl ? (
                                                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${l.type === "DEBIT" ? "bg-blue-50 text-blue-600" : "bg-violet-50 text-violet-600"}`}>
                                                    {l.type === "DEBIT" ? "Dr" : "Cr"}
                                                </span>
                                            ) : (
                                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">item</span>
                                            )}
                                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                                {isGl ? l.account.code : l.product.sku}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-foreground">
                                                {isGl ? l.account.name : l.product.name}
                                            </span>
                                            {!isGl && (
                                                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                                    {l.quantity}×₹{fmt(Number(l.rate))}
                                                </span>
                                            )}
                                            <span className="shrink-0 font-mono tabular-nums">₹ {fmt(Number(l.amount))}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </aside>
            )}

            </div>{/* end flex flex-1 overflow-hidden */}
        </div>
    );
}
