"use client";
// Day Book — chronological view of every voucher across all sources.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
    SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import { useCombinedVouchers } from "@/modules/accountancy/hooks/useCombinedVouchers";
import { indianFiscalYearStart, formatDateInput } from "@/modules/accountancy/lib/period";
import { VoucherRegisterTable } from "@/modules/accountancy/components/VoucherRegisterTable";

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

// ── Kind filter helper ────────────────────────────────────────────────────

function matchKind(kind: string, filter: string): boolean {
    switch (filter) {
        case "__all__":      return true;
        case "__sale_all__": return kind === "SALE" || kind === "POS" || kind === "SALE_RETURN";
        case "__buy_all__":  return kind === "PURCHASE" || kind === "PURCHASE_RETURN";
        case "__pay_all__":  return ["PAYMENT", "RECEIPT", "CONTRA", "CREDIT_NOTE", "DEBIT_NOTE"].includes(kind);
        default:             return kind === filter;
    }
}

// ── Optional / documentary voucher kinds ─────────────────────────────────
// Rendered with subtle dimming — they don't create direct accounting entries.

const OPTIONAL_KINDS = new Set([
    "ESTIMATE", "SALES_ORDER", "PURCHASE_ORDER",
    "GRN", "CHALLAN", "REJECTION_IN", "REJECTION_OUT",
    "MANUFACTURING_JOURNAL", "PHYSICAL_STOCK", "BRANCH_TRANSFER", "ISSUE", "ADJUSTMENT",
]);

// ── Page ──────────────────────────────────────────────────────────────────

export default function DayBookPage() {
    const { rows, loading, error, reload } = useCombinedVouchers();
    const router = useRouter();

    // ── Filter state (persisted to localStorage) ──────────────────────────
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

    const [branchFilter, setBranchFilter] = useState(() => {
        try { return localStorage.getItem("daybook:branchFilter") ?? "__all__"; }
        catch { return "__all__"; }
    });

    const [statuses, setStatuses] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem("daybook:statuses");
            return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
        } catch { return new Set(); }
    });
    const toggleStatus = (s: string) =>
        setStatuses((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

    // Persist filters
    useEffect(() => { try { localStorage.setItem("daybook:branchFilter",  branchFilter);                  } catch {} }, [branchFilter]);
    useEffect(() => { try { localStorage.setItem("daybook:preset",        preset);                        } catch {} }, [preset]);
    useEffect(() => { try { localStorage.setItem("daybook:from",          from);                          } catch {} }, [from]);
    useEffect(() => { try { localStorage.setItem("daybook:to",            to);                            } catch {} }, [to]);
    useEffect(() => { try { localStorage.setItem("daybook:kind",          kind);                          } catch {} }, [kind]);
    useEffect(() => { try { localStorage.setItem("daybook:statuses",      JSON.stringify([...statuses])); } catch {} }, [statuses]);
    useEffect(() => { try { localStorage.setItem("daybook:optionalOnly",  String(optionalOnly));          } catch {} }, [optionalOnly]);
    useEffect(() => { try { localStorage.setItem("daybook:inventoryOnly", String(inventoryOnly));         } catch {} }, [inventoryOnly]);

    // Escape → back
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (document.querySelector('[data-state="open"][role="dialog"]')) return;
            router.back();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [router]);

    // ── Filtering ─────────────────────────────────────────────────────────

    // Unique branches derived from all inv rows (stable even when branch filter is active).
    const availableBranches = useMemo(() => {
        const seen = new Map<string, string>();
        for (const r of rows) {
            if (r.branchId && r.branchName) seen.set(r.branchId, r.branchName);
        }
        return [...seen.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [rows]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        const OPT_SET = new Set(["ESTIMATE","SALES_ORDER","PURCHASE_ORDER","CHALLAN"]);
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
            if (branchFilter !== "__all__" && r.source === "inv" && r.branchId !== branchFilter) return false;
            if (q && !r.reference.toLowerCase().includes(q)
                  && !(r.narration ?? "").toLowerCase().includes(q)
                  && !(r.party     ?? "").toLowerCase().includes(q)) return false;
            return true;
        });
    }, [rows, from, to, statuses, kind, search, optionalOnly, inventoryOnly, branchFilter]);

    const postedTotal = filtered
        .filter((r) => r.status === "POSTED")
        .reduce((s, r) => s + r.totalAmount, 0);

    // Reset every user-controlled filter back to defaults. The "Show all" /
    // "Clear filters" banner uses this to escape the common footgun where
    // vouchers are dated outside the active window — the page silently shows
    // "0 of N rows" and the user can't tell why.
    const clearFilters = () => {
        applyPreset("thisFY");
        setSearch("");
        setKind("__all__");
        setStatuses(new Set());
        setOptionalOnly(false);
        setInventoryOnly(false);
        setBranchFilter("__all__");
    };
    const hiddenCount = rows.length - filtered.length;

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <div className="-m-8 flex h-full flex-col overflow-hidden">

            {/* Breadcrumb */}
            <header className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => router.back()} title="Back (Esc)">
                    <ArrowLeft size={15} />
                </Button>
                <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
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

                {/* Branch filter */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Branch</label>
                    <Select value={branchFilter} onValueChange={setBranchFilter}>
                        <SelectTrigger className="h-8 w-40">
                            <SelectValue placeholder="All branches" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">All branches</SelectItem>
                            {availableBranches.map((b) => (
                                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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

            {/* Hidden-rows banner — when filters drop every / nearly every row */}
            {hiddenCount > 0 && !loading && (
                <div className="flex shrink-0 items-center gap-3 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <span className="font-medium">
                        {filtered.length === 0
                            ? `All ${rows.length} voucher${rows.length === 1 ? "" : "s"} are hidden by the current filters.`
                            : `${hiddenCount} of ${rows.length} vouchers are hidden by the current filters.`}
                    </span>
                    <Button variant="outline" size="xs" className="h-6 text-xs" onClick={clearFilters}>
                        Clear filters (show all this FY)
                    </Button>
                </div>
            )}

            {/* Table */}
            <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
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
                            onChanged={reload}
                            stickyHead={true}
                            statusInline={true}
                            accentBySource={true}
                            showBranch={true}
                            optionalKinds={OPTIONAL_KINDS}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
