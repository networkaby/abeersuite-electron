"use client";

import { useEffect, useMemo, useState, useCallback, Fragment } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import { GatedLink } from "@/shared/components/GatedLink";
import {
    Loader2, ArrowLeft, AlertTriangle, ChevronRight, ChevronDown, Pencil,
    ArrowUp, ArrowDown, ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
    BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { fmt } from "@/shared/lib/format/moneyInr";
import { InvProductDialog } from "@/modules/inventory/components/InvProductDialog";
import { useEscape } from "@/shared/hooks";
import { BreadcrumbBar } from "@/shared/components/BreadcrumbBar";
import { TableScrollArea } from "@/shared/components/TableScrollArea";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

// ── Types ─────────────────────────────────────────────────────────────────────

type ValuationMethod = "LAST_INWARD" | "WEIGHTED_AVG" | "SIMPLE_AVG" | "FIFO" | "MONTHLY_AVG";

type Row = {
    id: number;
    sku: string;
    name: string;
    stock: number;
    lowStockThreshold: number;
    /** Named exactly as the API sends it — this field is read straight off the
     *  JSON, so a rename on either side has to be a rename on both. */
    effectiveSalePricePaise: number | null;
    /** Stock is stored in THIS unit — the one the voucher was typed in. */
    unit: { id: number; code: string; label: string };
    group: { id: number; name: string } | null;
    brand: { id: number; name: string } | null;
    category: { id: number; name: string } | null;
    /** PR 3 dropped costPaise — cost comes from the ledger-walked valuation
     *  block. unitCost is in rupees (not paise); value = stock × unitCost. */
    valuation: {
        unitCost: number;
        value: number;
        method: ValuationMethod;
        fallback?: "no-receipt-history" | "no-cost-basis";
    };
    isLow: boolean;
};

type Branch = { id: string; name: string };
type Response = { method: ValuationMethod; branches: Branch[]; rows: Row[] };
type View = "group" | "category" | "brand" | "item";

type SortKey =
    | "name" | "group" | "category" | "brand"
    | "quantity" | "rate" | "value"
    | "saleRate" | "saleValue" | "profit" | "margin";
type SortDir = "asc" | "desc";

function SortHeader({
    k, label, align = "left", sortKey, sortDir, toggleSort,
}: {
    k: SortKey;
    label: string;
    align?: "left" | "right";
    sortKey: SortKey;
    sortDir: SortDir;
    toggleSort: (k: SortKey) => void;
}) {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
        <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
            <button
                type="button"
                onClick={() => toggleSort(k)}
                className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
            >
                <span>{label}</span>
                <Icon size={11} className={active ? "" : "opacity-40"} />
            </button>
        </th>
    );
}

const METHOD_LABELS: Record<ValuationMethod, string> = {
    LAST_INWARD:  "Last Inward",
    WEIGHTED_AVG: "Weighted Avg",
    SIMPLE_AVG:   "Simple Avg",
    FIFO:         "FIFO",
    MONTHLY_AVG:  "Monthly Avg",
};

/**
 * The empty row both tables show. It only ever reaches the screen after a read
 * has come back — until then the spinner is up — so "no products" is an answer,
 * not a guess. A read that failed says that instead of blaming the catalogue.
 */
function EmptyRow({ colSpan, failed }: { colSpan: number; failed: boolean }) {
    return (
        <tr>
            <td colSpan={colSpan} className="px-3 py-10 text-center text-muted-foreground">
                {failed ? "Could not load stock summary." : "No active products found."}
            </td>
        </tr>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StockSummaryPage() {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const refSource = params.get("ref");

    // URL-synced state
    const [view, setViewState] = useState<View>(() => {
        const v = params.get("view");
        return v === "category" || v === "brand" || v === "item" ? v : "group";
    });
    const [sortKey, setSortKey] = useState<SortKey>("name");
    const [sortDir, setSortDir] = useState<SortDir>("asc");
    const toggleSort = (k: SortKey) => {
        if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else { setSortKey(k); setSortDir("asc"); }
    };
    const [method, setMethodState] = useState<ValuationMethod>(() => {
        const m = params.get("method");
        if (m === "WEIGHTED_AVG" || m === "SIMPLE_AVG" || m === "FIFO" || m === "LAST_INWARD" || m === "MONTHLY_AVG") {
            return m;
        }
        return "WEIGHTED_AVG";
    });
    const [showProfit, setShowProfitState] = useState<boolean>(() => params.get("profit") === "1");
    const [branchId, setBranchIdState] = useState<string>(() => params.get("branch") ?? "all");

    const [rows, setRows] = useState<Row[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    // Starts TRUE. With `false` the screen's first paint — the server-rendered
    // one, before the browser has even asked — said "loaded, and there is nothing
    // here", so it announced an empty catalogue for the whole of hydration plus
    // the ~4s valuation walk. A report may not claim a result before it has read.
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    // Inline edit dialog state
    const [editId, setEditId] = useState<number | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    // ── URL sync helper (don't lose ref/asOf when toggling controls) ──────────
    const pushUrl = useCallback(
        (next: { view?: View; method?: ValuationMethod; showProfit?: boolean; branchId?: string }) => {
            const qs = new URLSearchParams(params.toString());
            const v = next.view ?? view;
            const m = next.method ?? method;
            const p = next.showProfit ?? showProfit;
            const b = next.branchId ?? branchId;
            if (v === "group") qs.delete("view"); else qs.set("view", v);
            if (m === "WEIGHTED_AVG") qs.delete("method"); else qs.set("method", m);
            if (p) qs.set("profit", "1"); else qs.delete("profit");
            if (b === "all") qs.delete("branch"); else qs.set("branch", b);
            router.replace(`${pathname}?${qs.toString()}`);
        },
        [params, pathname, router, view, method, showProfit, branchId],
    );

    const setView = (v: View) => { setViewState(v); pushUrl({ view: v }); };
    const setMethod = (m: ValuationMethod) => { setMethodState(m); pushUrl({ method: m }); };
    const setShowProfit = (p: boolean) => { setShowProfitState(p); pushUrl({ showProfit: p }); };
    const setBranchId = (b: string) => { setBranchIdState(b); pushUrl({ branchId: b }); };

    // ── Fetch (depends on method + branch) ───────────────────────────────────
    const reload = useCallback(() => {
        setLoading(true);
        const qs = new URLSearchParams({ method });
        if (branchId !== "all") qs.set("branchId", branchId);
        return axios
            .get<Response>(`/api/inventory/reports/stock-summary?${qs.toString()}`)
            .then((r) => { setRows(r.data.rows); setBranches(r.data.branches); setFailed(false); })
            .catch(() => { setFailed(true); toast.error("Failed to load stock summary"); })
            .finally(() => setLoading(false));
    }, [method, branchId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; the loading flag reload() sets is intended
    useEffect(() => { reload(); }, [reload]);
    // Every stock voucher announces `stock`; re-read so the summary follows the floor.
    useRealtimeTopics(["stock"], () => { void reload(); });

    // ── Group + roll up (client side) ─────────────────────────────────────────
    const grouped = useMemo(() => {
        const keyName = (r: Row): string =>
            view === "group" ? r.group?.name ?? "Ungrouped"
                : view === "category" ? r.category?.name ?? "Uncategorised"
          /* brand */ : r.brand?.name ?? "No brand";

        const map = new Map<string, Row[]>();
        for (const r of rows) {
            const k = keyName(r);
            const arr = map.get(k);
            if (arr) arr.push(r); else map.set(k, [r]);
        }
        const groups = [...map.entries()]
            .map(([name, items]) => {
                items.sort((a, b) => a.name.localeCompare(b.name));
                const totalValue = items.reduce((s, r) => s + (r.valuation.value ?? 0), 0);
                const totalQty = items.reduce((s, r) => s + (r.stock > 0 ? r.stock : 0), 0);
                const unitCodes = new Set(items.map((r) => r.unit.code));
                const unitCode = unitCodes.size === 1 ? items[0].unit.code : null;

                // Profit roll-up — only rows with usable cost (valuation.value > 0)
                // and sale price. valuation.value is already stock × unitCost in rupees.
                const profitRows = items.filter((r) => r.valuation.value > 0 && r.effectiveSalePricePaise != null && r.stock > 0);
                const totalSaleValue = profitRows.reduce(
                    (s, r) => s + (r.stock * (r.effectiveSalePricePaise ?? 0)) / 100, 0,
                );
                const totalCostValue = profitRows.reduce(
                    (s, r) => s + r.valuation.value, 0,
                );
                const totalProfit = totalSaleValue - totalCostValue;
                const margin = totalSaleValue > 0 ? (totalProfit / totalSaleValue) * 100 : null;

                return { name, items, totalValue, totalQty, unitCode, totalSaleValue, totalProfit, margin, profitRows: profitRows.length };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
        return groups;
    }, [rows, view]);

    // Flat sortable list for the Item-wise view.
    const sortedItems = useMemo(() => {
        const arr = rows.slice();
        const dir = sortDir === "asc" ? 1 : -1;
        const num = (n: number | null | undefined) => (n == null ? -Infinity : n);
        arr.sort((a, b) => {
            switch (sortKey) {
                case "name": return dir * a.name.localeCompare(b.name);
                case "group": return dir * (a.group?.name ?? "").localeCompare(b.group?.name ?? "");
                case "category": return dir * (a.category?.name ?? "").localeCompare(b.category?.name ?? "");
                case "brand": return dir * (a.brand?.name ?? "").localeCompare(b.brand?.name ?? "");
                case "quantity": return dir * (a.stock - b.stock);
                case "rate": return dir * (a.valuation.unitCost - b.valuation.unitCost);
                case "value": return dir * (a.valuation.value - b.valuation.value);
                case "saleRate": return dir * (num(a.effectiveSalePricePaise) - num(b.effectiveSalePricePaise));
                case "saleValue": {
                    const av = a.effectiveSalePricePaise != null && a.stock > 0 ? (a.stock * a.effectiveSalePricePaise) / 100 : -Infinity;
                    const bv = b.effectiveSalePricePaise != null && b.stock > 0 ? (b.stock * b.effectiveSalePricePaise) / 100 : -Infinity;
                    return dir * (av - bv);
                }
                case "profit": {
                    // valuation.unitCost is in rupees; effectiveSalePricePaise / 100 = sale rupees.
                    const ap = a.valuation.unitCost > 0 && a.effectiveSalePricePaise != null && a.stock > 0
                        ? (a.effectiveSalePricePaise / 100 - a.valuation.unitCost) * a.stock : -Infinity;
                    const bp = b.valuation.unitCost > 0 && b.effectiveSalePricePaise != null && b.stock > 0
                        ? (b.effectiveSalePricePaise / 100 - b.valuation.unitCost) * b.stock : -Infinity;
                    return dir * (ap - bp);
                }
                case "margin": {
                    const am = a.valuation.unitCost > 0 && a.effectiveSalePricePaise != null && a.effectiveSalePricePaise > 0
                        ? ((a.effectiveSalePricePaise / 100 - a.valuation.unitCost) / (a.effectiveSalePricePaise / 100)) * 100 : -Infinity;
                    const bm = b.valuation.unitCost > 0 && b.effectiveSalePricePaise != null && b.effectiveSalePricePaise > 0
                        ? ((b.effectiveSalePricePaise / 100 - b.valuation.unitCost) / (b.effectiveSalePricePaise / 100)) * 100 : -Infinity;
                    return dir * (am - bm);
                }
            }
        });
        return arr;
    }, [rows, sortKey, sortDir]);

    // Auto-expand every group whenever the underlying group set changes
    // (initial load, view switch, refetch after save). User can collapse
    // individuals or use the global toggle. We sync to `grouped` length +
    // names so a new group added by editing a product also opens.
    useEffect(() => {
        if (grouped.length === 0) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- expand every group when the grouping changes
        setExpanded(new Set(grouped.map((g) => g.name)));
    }, [grouped]);

    const grandTotalValue = useMemo(
        () => rows.reduce((s, r) => s + (r.valuation.value ?? 0), 0),
        [rows],
    );
    const grandSaleValue = useMemo(
        () => rows
            .filter((r) => r.valuation.value > 0 && r.effectiveSalePricePaise != null && r.stock > 0)
            .reduce((s, r) => s + (r.stock * (r.effectiveSalePricePaise ?? 0)) / 100, 0),
        [rows],
    );
    const grandProfit = useMemo(
        () => rows
            .filter((r) => r.valuation.value > 0 && r.effectiveSalePricePaise != null && r.stock > 0)
            .reduce(
                (s, r) => s + ((r.effectiveSalePricePaise ?? 0) / 100 - r.valuation.unitCost) * r.stock,
                0,
            ),
        [rows],
    );
    const grandMargin = grandSaleValue > 0 ? (grandProfit / grandSaleValue) * 100 : null;

    const fallbackCount = useMemo(
        () => rows.filter((r) => r.valuation.fallback === "no-receipt-history").length,
        [rows],
    );

    const toggle = (name: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
        });

    const allExpanded = grouped.length > 0 && grouped.every((g) => expanded.has(g.name));
    const toggleAll = () => {
        if (allExpanded) setExpanded(new Set());
        else setExpanded(new Set(grouped.map((g) => g.name)));
    };

    const openEdit = (id: number) => {
        setEditId(id);
        setDialogOpen(true);
    };

    useEscape(() => router.back());

    // Column counts
    // Always: Particulars(1) + Qty(1) + Rate(1) + Value(1) = 4
    // + Edit(1) on the right
    // When !showProfit: Category(1) + Brand(1) before Quantity → +2
    // When showProfit: Sale Rate(1) + Sale Value(1) + Profit(1) + Margin(1) → +4
    // Trailing edit cell is always present.
    const showCatBrandCols = !showProfit;

    // ── Render helpers ────────────────────────────────────────────────────────
    const sortProps = { sortKey, sortDir, toggleSort };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex h-full flex-col">
            {/* Breadcrumb bar — uniform with the other inventory pages */}
            <BreadcrumbBar>
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link href="/office/accountancy">Accountancy</Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Stock Summary</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </BreadcrumbBar>

            <div className="flex min-h-0 flex-1 flex-col gap-2 px-6 pb-6 pt-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    {/* <h2 className="text-xl font-semibold tracking-tight">Stock Summary</h2> */}
                    {/* <p className="text-sm text-muted-foreground mt-0.5">
                        Live valuation
                        {asOf && (
                            <span className="ml-1">
                                · as at{" "}
                                {new Date(asOf).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            </span>
                        )}
                    </p> */}
                </div>
                {refSource === "balance-sheet" && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push("/office/accountancy/reports/balance-sheet")}
                    >
                        <ArrowLeft size={14} className="mr-1" />
                        Back to Balance Sheet
                    </Button>
                )}
            </div>

            {/* Control bar */}
            <div className="flex items-center gap-3 flex-wrap text-sm -mt-2">
                {/* View */}
                <div className="inline-flex items-center rounded-md border border-border p-0.5 bg-card">
                    {(["group", "category", "brand", "item"] as View[]).map((v) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => setView(v)}
                            className={`px-3 py-1 rounded-sm capitalize ${view === v
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted"
                                }`}
                        >
                            {v === "item" ? "Item-wise" : v}
                        </button>
                    ))}
                </div>

                {/* Method */}
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Method</span>
                    <Select value={method} onValueChange={(v) => setMethod(v as ValuationMethod)}>
                        <SelectTrigger className="h-8 w-[160px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(["LAST_INWARD", "WEIGHTED_AVG", "SIMPLE_AVG", "FIFO", "MONTHLY_AVG"] as ValuationMethod[]).map((m) => (
                                <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Branch */}
                {branches.length > 0 && (
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Branch</span>
                        <Select value={branchId} onValueChange={setBranchId}>
                            <SelectTrigger className="h-8 w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All branches</SelectItem>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                {/* Expand / Collapse all (not meaningful in item view) */}
                {view !== "item" && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={toggleAll}
                        disabled={grouped.length === 0}
                    >
                        {allExpanded ? <ChevronDown size={14} className="mr-1" /> : <ChevronRight size={14} className="mr-1" />}
                        {allExpanded ? "Collapse all" : "Expand all"}
                    </Button>
                )}

                {/* Show Profit */}
                <label className="inline-flex items-center gap-2 cursor-pointer select-none ml-auto">
                    <input
                        type="checkbox"
                        checked={showProfit}
                        onChange={(e) => setShowProfit(e.target.checked)}
                        className="h-4 w-4"
                    />
                    Show Profit
                </label>
            </div>

            {/* Table */}
            {loading && rows.length === 0 && (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-muted-foreground" size={26} />
                </div>
            )}

            {(!loading || rows.length > 0) && view !== "item" && (
                <TableScrollArea className="-mx-6 -mb-6 rounded-lg">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-muted/40 backdrop-blur-sm">
                            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                                <th className="px-3 py-2 text-left font-medium">Particulars</th>
                                {showCatBrandCols && (
                                    <>
                                        <th className="px-3 py-2 text-left font-medium">Category</th>
                                        <th className="px-3 py-2 text-left font-medium">Brand</th>
                                    </>
                                )}
                                <th className="px-3 py-2 text-right font-medium">Quantity</th>
                                <th className="px-3 py-2 text-right font-medium">Rate</th>
                                <th className="px-3 py-2 text-right font-medium">Value</th>
                                {showProfit && (
                                    <>
                                        <th className="px-3 py-2 text-right font-medium">Sale Rate</th>
                                        <th className="px-3 py-2 text-right font-medium">Sale Value</th>
                                        <th className="px-3 py-2 text-right font-medium">Profit</th>
                                        <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                    </>
                                )}
                                <th className="px-3 py-2 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {grouped.length === 0 && (
                                <EmptyRow colSpan={showProfit ? 9 : 7} failed={failed} />
                            )}
                            {grouped.map((g) => {
                                const isOpen = expanded.has(g.name);
                                return (
                                    <Fragment key={g.name}>
                                        {/* Group row */}
                                        <tr
                                            className="bg-muted/30 hover:bg-muted/50 cursor-pointer"
                                            onClick={() => toggle(g.name)}
                                        >
                                            <td className="px-3 py-2 font-semibold">
                                                <span className="inline-flex items-center gap-1">
                                                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                    {g.name}
                                                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                        ({g.items.length} item{g.items.length === 1 ? "" : "s"})
                                                    </span>
                                                </span>
                                            </td>
                                            {showCatBrandCols && (
                                                <>
                                                    <td className="px-3 py-2 text-muted-foreground/65">—</td>
                                                    <td className="px-3 py-2 text-muted-foreground/65">—</td>
                                                </>
                                            )}
                                            <td className="px-3 py-2 text-right font-mono">
                                                {g.unitCode != null && g.totalQty > 0 ? `${g.totalQty} ${g.unitCode}` : <span className="text-muted-foreground/65">—</span>}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono text-muted-foreground/65">—</td>
                                            <td className="px-3 py-2 text-right font-mono font-semibold">
                                                {g.totalValue !== 0 ? fmt(g.totalValue) : <span className="text-muted-foreground/65">—</span>}
                                            </td>
                                            {showProfit && (
                                                <>
                                                    <td className="px-3 py-2 text-right font-mono text-muted-foreground/65">—</td>
                                                    <td className="px-3 py-2 text-right font-mono">
                                                        {g.totalSaleValue > 0 ? fmt(g.totalSaleValue) : <span className="text-muted-foreground/65">—</span>}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right font-mono ${g.totalProfit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                                                        {g.profitRows > 0 ? fmt(g.totalProfit) : <span className="text-muted-foreground/65">—</span>}
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono">
                                                        {g.margin != null ? `${g.margin.toFixed(2)}%` : <span className="text-muted-foreground/65">—</span>}
                                                    </td>
                                                </>
                                            )}
                                            <td className="px-3 py-2"></td>
                                        </tr>
                                        {/* Item rows */}
                                        {isOpen && g.items.map((r) => {
                                            const saleValue = r.effectiveSalePricePaise != null && r.stock > 0 ? (r.stock * r.effectiveSalePricePaise) / 100 : null;
                                            const profit = r.valuation.unitCost > 0 && r.effectiveSalePricePaise != null && r.stock > 0
                                                ? ((r.effectiveSalePricePaise / 100) - r.valuation.unitCost) * r.stock
                                                : null;
                                            const margin = saleValue != null && saleValue > 0 && profit != null ? (profit / saleValue) * 100 : null;
                                            return (
                                                <tr
                                                    key={r.id}
                                                    className={r.isLow ? "bg-amber-50/40 hover:bg-amber-100/60 dark:bg-amber-950/10 dark:hover:bg-amber-900/20" : "hover:bg-muted/30"}
                                                >
                                                    <td className="px-3 py-1.5 pl-9">
                                                        <GatedLink whenLocked="text" textClassName="text-foreground"
                                                            href={`/office/inventory/inventory-details?productId=${r.id}`}
                                                            className="text-foreground hover:text-primary hover:underline"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            {r.name}
                                                        </GatedLink>
                                                        <span className="ml-2 font-mono text-xs text-muted-foreground/70">{r.sku}</span>
                                                        {r.isLow && (
                                                            <span className="ml-2 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-xs">
                                                                <AlertTriangle size={11} />
                                                                Low
                                                            </span>
                                                        )}
                                                    </td>
                                                    {showCatBrandCols && (
                                                        <>
                                                            <td className="px-3 py-1.5 text-xs text-muted-foreground">
                                                                {r.category?.name ?? <span className="text-muted-foreground/65">—</span>}
                                                            </td>
                                                            <td className="px-3 py-1.5 text-xs text-muted-foreground">
                                                                {r.brand?.name ?? <span className="text-muted-foreground/65">—</span>}
                                                            </td>
                                                        </>
                                                    )}
                                                    <td className="px-3 py-1.5 text-right font-mono">
                                                        {r.stock} {r.unit.code}
                                                    </td>
                                                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                                        {r.valuation.unitCost > 0
                                                            ? fmt(r.valuation.unitCost)
                                                            : <span className="text-muted-foreground/65">—</span>}
                                                    </td>
                                                    <td className="px-3 py-1.5 text-right font-mono">
                                                        {r.valuation.value > 0
                                                            ? fmt(r.valuation.value)
                                                            : <span className="text-muted-foreground/65">—</span>}
                                                    </td>
                                                    {showProfit && (
                                                        <>
                                                            <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                                                {r.effectiveSalePricePaise != null ? fmt(r.effectiveSalePricePaise / 100) : <span className="text-muted-foreground/65">—</span>}
                                                            </td>
                                                            <td className="px-3 py-1.5 text-right font-mono">
                                                                {saleValue != null ? fmt(saleValue) : <span className="text-muted-foreground/65">—</span>}
                                                            </td>
                                                            <td className={`px-3 py-1.5 text-right font-mono ${profit != null && profit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                                                                {profit != null ? fmt(profit) : <span className="text-muted-foreground/65">—</span>}
                                                            </td>
                                                            <td className="px-3 py-1.5 text-right font-mono">
                                                                {margin != null ? `${margin.toFixed(2)}%` : <span className="text-muted-foreground/65">—</span>}
                                                            </td>
                                                        </>
                                                    )}
                                                    <td className="px-2 py-1 text-right">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            onClick={(e) => { e.stopPropagation(); openEdit(r.id); }}
                                                            title="Edit product master"
                                                            aria-label={`Edit ${r.name}`}
                                                        >
                                                            <Pencil className="size-3.5" />
                                                        </Button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                                <td className="px-3 py-2">Grand Total</td>
                                {showCatBrandCols && (
                                    <>
                                        <td></td>
                                        <td></td>
                                    </>
                                )}
                                <td className="px-3 py-2 text-right font-mono text-muted-foreground/65">—</td>
                                <td className="px-3 py-2 text-right font-mono text-muted-foreground/65">—</td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(grandTotalValue)}</td>
                                {showProfit && (
                                    <>
                                        <td className="px-3 py-2 text-right font-mono text-muted-foreground/65">—</td>
                                        <td className="px-3 py-2 text-right font-mono">
                                            {grandSaleValue > 0 ? fmt(grandSaleValue) : <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                        <td className={`px-3 py-2 text-right font-mono ${grandProfit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                                            {grandSaleValue > 0 ? fmt(grandProfit) : <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">
                                            {grandMargin != null ? `${grandMargin.toFixed(2)}%` : <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                    </>
                                )}
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </TableScrollArea>
            )}

            {/* Item-wise view — flat, sortable, no group rollups */}
            {(!loading || rows.length > 0) && view === "item" && (
                <TableScrollArea className="-mx-6 -mb-6 rounded-lg ">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-muted/40 backdrop-blur-sm">
                            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                                <SortHeader k="name" label="Name" {...sortProps} />
                                <SortHeader k="group" label="Group" {...sortProps} />
                                <SortHeader k="category" label="Category" {...sortProps} />
                                <SortHeader k="brand" label="Brand" {...sortProps} />
                                <SortHeader k="quantity" label="Quantity" align="right" {...sortProps} />
                                <SortHeader k="rate" label="Rate" align="right" {...sortProps} />
                                <SortHeader k="value" label="Value" align="right" {...sortProps} />
                                {showProfit && (
                                    <>
                                        <SortHeader k="saleRate" label="Sale Rate" align="right" {...sortProps} />
                                        <SortHeader k="saleValue" label="Sale Value" align="right" {...sortProps} />
                                        <SortHeader k="profit" label="Profit" align="right" {...sortProps} />
                                        <SortHeader k="margin" label="Margin %" align="right" {...sortProps} />
                                    </>
                                )}
                                <th className="px-3 py-2 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {sortedItems.length === 0 && (
                                <EmptyRow colSpan={showProfit ? 12 : 8} failed={failed} />
                            )}
                            {sortedItems.map((r) => {
                                const saleValue = r.effectiveSalePricePaise != null && r.stock > 0 ? (r.stock * r.effectiveSalePricePaise) / 100 : null;
                                const profit = r.valuation.unitCost > 0 && r.effectiveSalePricePaise != null && r.stock > 0
                                    ? ((r.effectiveSalePricePaise / 100) - r.valuation.unitCost) * r.stock
                                    : null;
                                const margin = r.valuation.unitCost > 0 && r.effectiveSalePricePaise != null && r.effectiveSalePricePaise > 0
                                    ? ((r.effectiveSalePricePaise / 100 - r.valuation.unitCost) / (r.effectiveSalePricePaise / 100)) * 100
                                    : null;
                                return (
                                    <tr
                                        key={r.id}
                                        className={r.isLow ? "bg-amber-50/40 hover:bg-amber-100/60 dark:bg-amber-950/10 dark:hover:bg-amber-900/20" : "hover:bg-muted/30"}
                                    >
                                        <td className="px-3 py-1.5">
                                            <GatedLink whenLocked="text" textClassName="text-foreground"
                                                href={`/office/inventory/inventory-details?productId=${r.id}`}
                                                className="text-foreground hover:text-primary hover:underline"
                                            >
                                                {r.name}
                                            </GatedLink>
                                            <span className="ml-2 font-mono text-xs text-muted-foreground/70">{r.sku}</span>
                                            {r.isLow && (
                                                <span className="ml-2 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-xs">
                                                    <AlertTriangle size={11} />
                                                    Low
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                                            {r.group?.name ?? <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                                            {r.category?.name ?? <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                                            {r.brand?.name ?? <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-mono">
                                            {r.stock} {r.unit.code}
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                            {r.valuation.unitCost > 0
                                                ? fmt(r.valuation.unitCost)
                                                : <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-mono">
                                            {r.valuation.value > 0
                                                ? fmt(r.valuation.value)
                                                : <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                        {showProfit && (
                                            <>
                                                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                                    {r.effectiveSalePricePaise != null ? fmt(r.effectiveSalePricePaise / 100) : <span className="text-muted-foreground/65">—</span>}
                                                </td>
                                                <td className="px-3 py-1.5 text-right font-mono">
                                                    {saleValue != null ? fmt(saleValue) : <span className="text-muted-foreground/65">—</span>}
                                                </td>
                                                <td className={`px-3 py-1.5 text-right font-mono ${profit != null && profit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                                                    {profit != null ? fmt(profit) : <span className="text-muted-foreground/65">—</span>}
                                                </td>
                                                <td className="px-3 py-1.5 text-right font-mono">
                                                    {margin != null ? `${margin.toFixed(2)}%` : <span className="text-muted-foreground/65">—</span>}
                                                </td>
                                            </>
                                        )}
                                        <td className="px-2 py-1 text-right">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => openEdit(r.id)}
                                                title="Edit product master"
                                                aria-label={`Edit ${r.name}`}
                                            >
                                                <Pencil className="size-3.5" />
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                                <td className="px-3 py-2" colSpan={4}>Grand Total ({sortedItems.length} item{sortedItems.length === 1 ? "" : "s"})</td>
                                <td className="px-3 py-2 text-right font-mono text-muted-foreground/65">—</td>
                                <td className="px-3 py-2 text-right font-mono text-muted-foreground/65">—</td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(grandTotalValue)}</td>
                                {showProfit && (
                                    <>
                                        <td className="px-3 py-2 text-right font-mono text-muted-foreground/65">—</td>
                                        <td className="px-3 py-2 text-right font-mono">
                                            {grandSaleValue > 0 ? fmt(grandSaleValue) : <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                        <td className={`px-3 py-2 text-right font-mono ${grandProfit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                                            {grandSaleValue > 0 ? fmt(grandProfit) : <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">
                                            {grandMargin != null ? `${grandMargin.toFixed(2)}%` : <span className="text-muted-foreground/65">—</span>}
                                        </td>
                                    </>
                                )}
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </TableScrollArea>
            )}

            {/* Fallback footnote */}
            {!loading && fallbackCount > 0 && (
                <p className="text-xs text-muted-foreground">
                    Valued using {METHOD_LABELS[method]}. {fallbackCount} product{fallbackCount === 1 ? "" : "s"} fell back to opening rate (no inward history).
                </p>
            )}
            </div>

            {/* Inline edit dialog */}
            <InvProductDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                editId={editId}
                onSaved={reload}
            />
        </div>
    );
}
