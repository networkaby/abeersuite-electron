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
import { useRegisterFilters, type DatePreset } from "@/modules/accountancy/hooks/useRegisterFilters";
import { VoucherRegisterTable } from "@/modules/accountancy/components/VoucherRegisterTable";
import { TallyDateInput } from "@/shared/components/TallyDateInput";

// ── Kind filter helper ────────────────────────────────────────────────────

function matchKind(kind: string, filter: string): boolean {
    switch (filter) {
        case "__all__":      return true;
        case "__sale_all__": return kind === "SALE" || kind === "POS" || kind === "ONLINE_INVOICE" || kind === "SALE_RETURN";
        case "__buy_all__":  return kind === "PURCHASE" || kind === "PURCHASE_RETURN";
        case "__pay_all__":  return ["PAYMENT", "RECEIPT", "CONTRA", "CREDIT_NOTE", "DEBIT_NOTE"].includes(kind);
        default:             return kind === filter;
    }
}

// ── Non-regular voucher classification ───────────────────────────────────
// Single source of truth for the two "Category" quick-filters AND the row
// styling, so they can't drift apart (they previously did — POS estimate/order
// were in neither, so "Optional only" wrongly hid them).

// Documentary / "optional" — quotes & commitments that post no money or stock
// on their own. A POS estimate / order is not a regular voucher, so it lives here.
const OPTIONAL_KINDS = new Set([
    "ESTIMATE", "POS_ESTIMATE", "POS_ORDER", "ONLINE_ORDER",
    "SALES_ORDER", "PURCHASE_ORDER", "CHALLAN",
]);
// Inventory-ops — stock movement with no direct GL post.
const INVENTORY_KINDS = new Set([
    "GRN", "REJECTION_IN", "REJECTION_OUT",
    "MANUFACTURING_JOURNAL", "PHYSICAL_STOCK", "BRANCH_TRANSFER",
]);
// Union — every non-regular row gets the muted/italic documentary styling.
const NON_REGULAR_KINDS = new Set([...OPTIONAL_KINDS, ...INVENTORY_KINDS]);

// ── Page ──────────────────────────────────────────────────────────────────

export default function DayBookPage() {
    const router = useRouter();

    // Shared date/period/search/status/branch filter state (localStorage-persisted).
    const filters = useRegisterFilters("daybook");

    // The visible period IS the fetch window now — widening it pulls only the
    // slice not already cached, instead of the old "download everything, then
    // hide most of it" behaviour. Everything below still filters client-side.
    const { rows, loading, error, reload } = useCombinedVouchers(filters.from, filters.to);

    // Day Book-specific filters not in the shared hook.
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

    useEffect(() => { try { localStorage.setItem("daybook:kind",          kind);                  } catch {} }, [kind]);
    useEffect(() => { try { localStorage.setItem("daybook:optionalOnly",  String(optionalOnly));  } catch {} }, [optionalOnly]);
    useEffect(() => { try { localStorage.setItem("daybook:inventoryOnly", String(inventoryOnly)); } catch {} }, [inventoryOnly]);

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
        const q = filters.search.toLowerCase();
        return rows.filter((r) => {
            const d = r.date.slice(0, 10);
            if (filters.from && d < filters.from) return false;
            if (filters.to   && d > filters.to)   return false;
            if (filters.statuses.size > 0 && !filters.statuses.has(r.status)) return false;
            if (!matchKind(r.kind, kind)) return false;
            if (optionalOnly || inventoryOnly) {
                const isOpt = optionalOnly && OPTIONAL_KINDS.has(r.kind);
                const isInv = inventoryOnly && INVENTORY_KINDS.has(r.kind);
                if (!isOpt && !isInv) return false;
            }
            // Filter any row that carries a branch (inv always; gl POS receipts/
            // expenditures now do too). Org-level vouchers (null branch) always show.
            if (filters.branchFilter !== "__all__" && r.branchId != null && r.branchId !== filters.branchFilter) return false;
            if (q && !r.reference.toLowerCase().includes(q)
                  && !(r.narration ?? "").toLowerCase().includes(q)
                  && !(r.party     ?? "").toLowerCase().includes(q)) return false;
            return true;
        });
    }, [rows, filters.from, filters.to, filters.statuses, kind, filters.search, optionalOnly, inventoryOnly, filters.branchFilter]);

    const postedTotal = filtered
        .filter((r) => r.status === "POSTED")
        .reduce((s, r) => s + r.totalAmount, 0);

    const clearFilters = () => {
        filters.clearFilters();
        setKind("__all__");
        setOptionalOnly(false);
        setInventoryOnly(false);
    };
    const hiddenCount = rows.length - filtered.length;

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <div className="flex h-full flex-col overflow-hidden">

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
                        <Select value={filters.preset} onValueChange={(v) => filters.setPreset(v as DatePreset)}>
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
                        <TallyDateInput value={filters.from} onValueChange={filters.handleFrom} className="h-8 w-36" />
                    </div>
                    <span className="pb-1.5 text-muted-foreground text-xs">→</span>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">To</label>
                        <TallyDateInput value={filters.to} onValueChange={filters.handleTo} monthMode="end" className="h-8 w-36" />
                    </div>
                </div>

                {/* Search */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Search</label>
                    <Input
                        value={filters.search}
                        onChange={(e) => filters.setSearch(e.target.value)}
                        placeholder="ref / party / narration"
                        className="h-8 w-52"
                    />
                </div>

                {/* Branch filter */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Branch</label>
                    <Select value={filters.branchFilter} onValueChange={filters.setBranchFilter}>
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
                                <SelectItem value="ONLINE_INVOICE">Online Invoice</SelectItem>
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
                                <SelectItem value="POS_ESTIMATE">POS Estimate</SelectItem>
                                <SelectItem value="SALES_ORDER">Sales Order</SelectItem>
                                <SelectItem value="POS_ORDER">POS Order</SelectItem>
                                <SelectItem value="ONLINE_ORDER">Online Order</SelectItem>
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
                                checked={filters.statuses.size === 0}
                                onCheckedChange={filters.clearStatuses}
                            />
                            <Label htmlFor="status-all" className="text-xs cursor-pointer">All</Label>
                        </div>
                        {(["DRAFT", "POSTED", "CANCELLED"] as const).map((s) => (
                            <div key={s} className="flex items-center gap-1.5">
                                <Checkbox
                                    id={`status-${s}`}
                                    checked={filters.statuses.has(s)}
                                    onCheckedChange={() => filters.toggleStatus(s)}
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

            {/* Hidden-rows banner */}
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
                            optionalKinds={NON_REGULAR_KINDS}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
