"use client";
// Day Book — chronological view of every voucher across all sources.
//
// Filtering happens on the SERVER now. The page pulls 50 rows at a time and
// fetches the next 50 as you scroll, so a period is a boundary rather than a
// download — picking "This FY" no longer drags a year of vouchers into the
// browser before you have asked to see any of them. Filtering here instead would
// only filter the rows already pulled, which is why the kind / status / branch /
// category / search controls all become query params.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
    SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";
import { useDayBook } from "@/modules/accountancy/hooks/useDayBook";
import { useRegisterFilters, type DatePreset } from "@/modules/accountancy/hooks/useRegisterFilters";
import { NON_REGULAR_KINDS } from "@/modules/accountancy/lib/voucherKinds";
import { VoucherRegisterTable } from "@/modules/accountancy/components/VoucherRegisterTable";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

/** "" | "optional" | "inventory" — the two mutually-exclusive category ticks. */
type Category = "" | "optional" | "inventory";

export default function DayBookPage() {
    const router = useRouter();

    // Shared date/period/search/status/branch filter state (localStorage-persisted).
    // Opens on TODAY: the Day Book is where you look at what just happened.
    const filters = useRegisterFilters("daybook", "today");

    // Day Book-specific filters not in the shared hook.
    const [kind, setKind] = useState(() => {
        try { return localStorage.getItem("daybook:kind") ?? "__all__"; }
        catch { return "__all__"; }
    });
    const [category, setCategory] = useState<Category>(() => {
        try { return (localStorage.getItem("daybook:category") as Category | null) ?? ""; }
        catch { return ""; }
    });

    useEffect(() => { try { localStorage.setItem("daybook:kind",     kind);     } catch {} }, [kind]);
    useEffect(() => { try { localStorage.setItem("daybook:category", category); } catch {} }, [category]);

    const statuses = useMemo(() => [...filters.statuses], [filters.statuses]);
    const query = useMemo(() => ({
        from:     filters.from,
        to:       filters.to,
        kind,
        statuses,
        branchId: filters.branchFilter,
        category,
        search:   filters.search,
    }), [filters.from, filters.to, kind, statuses, filters.branchFilter, category, filters.search]);

    const {
        rows, loading, loadingMore, hasMore, error, stale, loadMore, reload, syncNow, branches,
    } = useDayBook(query);

    // A voucher written at another counter — or in another tab — lands here on
    // its own. No polling: the page reads only when something has actually
    // moved, and only while it is the tab being looked at.
    //
    // `syncNow`, not `reload` — a signal tops up what is on screen and keeps the
    // pages already scrolled through. Starting over is what the Refresh button
    // means, and only a person pressing it should get it.
    useRealtimeTopics(["ledger"], syncNow);

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

    // Infinite scroll — the sentinel sits under the table and asks for the next
    // page as it comes into view.
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

    // Totals cover the rows actually pulled, not the whole period — the label says
    // so rather than implying a period total the page has not read.
    const postedTotal = rows
        .filter((r) => r.status === "POSTED")
        .reduce((s, r) => s + r.totalAmount, 0);

    const clearFilters = () => {
        filters.clearFilters();
        setKind("__all__");
        setCategory("");
    };

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
                            {branches.map((b) => (
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

                {/* Category quick-filters — mutually exclusive by construction. */}
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Category</span>
                    <div className="flex items-center gap-4 h-8">
                        <div className="flex items-center gap-1.5">
                            <Checkbox
                                id="cat-optional"
                                checked={category === "optional"}
                                onCheckedChange={(v) => setCategory(v ? "optional" : "")}
                            />
                            <Label htmlFor="cat-optional" className="text-xs cursor-pointer italic">Optional only</Label>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Checkbox
                                id="cat-inventory"
                                checked={category === "inventory"}
                                onCheckedChange={(v) => setCategory(v ? "inventory" : "")}
                            />
                            <Label htmlFor="cat-inventory" className="text-xs cursor-pointer">Inventory only</Label>
                        </div>
                    </div>
                </div>

                {/* Summary */}
                <div className="ml-auto text-right self-end pb-0.5">
                    <div className="text-xs text-muted-foreground">
                        {rows.length} row{rows.length === 1 ? "" : "s"}{hasMore ? " so far" : ""}
                    </div>
                    <div className="text-sm font-mono font-medium" title="Covers the rows loaded so far, not the whole period">
                        Posted (loaded) ₹ {fmt(postedTotal)}
                    </div>
                </div>
                <div className="flex items-end gap-2">
                    <Button variant="outline" size="sm" onClick={clearFilters}>Clear</Button>
                    <Button variant="outline" size="sm" onClick={reload}>Refresh</Button>
                </div>
            </div>

            {/* Offline notice — a counter keeps its own copy, so the books stay
                readable with the connection down. */}
            {stale && (
                <div className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <WifiOff size={13} className="shrink-0" />
                    <span>Showing the copy saved on this computer — could not reach the server.</span>
                    <Button variant="outline" size="xs" className="h-6 text-xs" onClick={reload}>Try again</Button>
                </div>
            )}

            {/* Table */}
            <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
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
                                rows={rows}
                                onChanged={reload}
                                stickyHead={true}
                                statusInline={true}
                                accentBySource={true}
                                showBranch={true}
                                optionalKinds={NON_REGULAR_KINDS}
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
            </div>
        </div>
    );
}
