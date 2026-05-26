"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import axios from "axios";
import { toast } from "sonner";
import { Boxes, Save, Wand2, Lock, Unlock, RefreshCw, ShieldAlert, AlertTriangle, AlertCircle, X, ArrowRight, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { TableEmptyRow, TableLoadingRow } from "@/shared/components/DataTableStates";

type CostMethod =
    | "WEIGHTED_AVG_COST"
    | "FIFO"
    | "LAST_PURCHASE_COST"
    | "MONTHLY_AVG_COST"
    | "STD_COST";

const COST_METHOD_LABEL: Record<CostMethod, string> = {
    WEIGHTED_AVG_COST:  "Weighted Avg",
    FIFO:               "FIFO",
    LAST_PURCHASE_COST: "Last Purchase",
    MONTHLY_AVG_COST:   "Monthly Avg",
    STD_COST:           "Standard",
};

type Item = {
    id:                    number;
    sku:                   string;
    name:                  string;
    categoryName:          string | null;
    groupName:             string | null;
    brandName:             string | null;
    /** Current cached stock balance. null = not tracked. */
    stock:                 number | null;
    /** Per-item override. null = inherit from strategy. */
    costMethod:            CostMethod | null;
    /** What was actually used: product.costMethod ?? strategy.costMethod ?? WA. */
    effectiveCostMethod:   CostMethod;
    /** Strategy's default cost method (informational). */
    strategyCostMethod:    CostMethod | null;
    marginPercent:         number | null;
    priceOverridden:       boolean;
    pricePaise:            number | null;
    mrpPaise:              number | null;
    stdCostPaise:          number | null;
    lastPurchasePaise:     number | null;
    resolvedCostPaise:     number | null;
    resolvedCostFallback:  string | null;
    computedPricePaise:    number | null;
    rawComputedPricePaise: number | null;
    cappedAtMrp:           boolean;
    strategyId:            number | null;
    strategyName:          string | null;
    appliedMarkupPct:      number;
    appliedFlatPaise:      number;
    appliedRoundingPaise:  number;
};

type RowEdit = {
    /** "__inherit" sentinel = null (use strategy default). */
    costMethod:    CostMethod | "__inherit";
    marginPercent: string; // "" = clear override (use strategy)
    /** Rupees string entered by user (e.g. "296.61"). Empty = no manual change. */
    priceRupees:   string;
};

function paise(p: number | null): string {
    if (p == null) return "—";
    return `₹${(p / 100).toFixed(2)}`;
}

/** Convert a user-typed rupees string to paise integer, or null if invalid/empty. */
function rupeesToPaise(s: string): number | null {
    const trimmed = s.trim();
    if (trimmed === "") return null;
    const n = parseFloat(trimmed);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
}

interface Attention {
    /** True for any missing field. */
    needs:    boolean;
    /** True when cost is missing — blocker, can't price the item at all. */
    critical: boolean;
    /** Human-readable list of missing fields. */
    missing:  string[];
}

function attentionFor(item: Item): Attention {
    const missing: string[] = [];
    const noCost  = item.resolvedCostPaise == null;
    const noMrp   = item.mrpPaise == null || item.mrpPaise <= 0;
    const noPrice = item.pricePaise == null;
    if (noCost)  missing.push("cost");
    if (noMrp)   missing.push("MRP");
    if (noPrice) missing.push("price");
    return { needs: missing.length > 0, critical: noCost, missing };
}

export default function PricingItemsPage() {
    const [items,               setItems]               = useState<Item[]>([]);
    const [loading,             setLoading]             = useState(true);
    const [search,              setSearch]              = useState("");
    const [hideEmpty,           setHideEmpty]           = useState(false);
    const [filterCategory,  setFilterCategory]  = useState<string>("__all");
    const [filterBrand,     setFilterBrand]     = useState<string>("__all");
    const [filterGroup,     setFilterGroup]     = useState<string>("__all");
    const [filterMethod,    setFilterMethod]    = useState<string>("__all");
    const [filterStrategy,  setFilterStrategy]  = useState<string>("__all");

    // Pre-fill strategy filter from ?strategy=<id> (link from Strategies page).
    const searchParams = useSearchParams();
    useEffect(() => {
        const sid = searchParams.get("strategy");
        if (sid) setFilterStrategy(sid);
    }, [searchParams]);
    const [edits,           setEdits]           = useState<Record<number, RowEdit>>({});
    const [savingId,        setSavingId]        = useState<number | null>(null);
    const [applying,        setApplying]        = useState(false);

    const load = () => {
        setLoading(true);
        axios
            .get<Item[]>("/api/pricing-strategy/items")
            .then((r) => setItems(r.data))
            .catch(() => toast.error("Failed to load pricing items"))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    const uniqueCategories = useMemo(() => {
        const set = new Set<string>();
        for (const i of items) if (i.categoryName) set.add(i.categoryName);
        return [...set].sort();
    }, [items]);
    const uniqueBrands = useMemo(() => {
        const set = new Set<string>();
        for (const i of items) if (i.brandName) set.add(i.brandName);
        return [...set].sort();
    }, [items]);
    const uniqueGroups = useMemo(() => {
        const set = new Set<string>();
        for (const i of items) if (i.groupName) set.add(i.groupName);
        return [...set].sort();
    }, [items]);
    const uniqueStrategies = useMemo(() => {
        const map = new Map<number, string>();
        for (const i of items) if (i.strategyId != null && i.strategyName) map.set(i.strategyId, i.strategyName);
        return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    }, [items]);

    // Base filter — no attention split yet.
    const baseFiltered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return items.filter((i) => {
            // "Empty" = zero stock on hand. Stock = null (not tracked, e.g.
            // services) is left visible.
            if (hideEmpty && i.stock != null && i.stock <= 0) return false;
            if (filterCategory !== "__all" && i.categoryName !== filterCategory) return false;
            if (filterBrand    !== "__all" && i.brandName    !== filterBrand)    return false;
            if (filterGroup    !== "__all" && i.groupName    !== filterGroup)    return false;
            if (filterMethod   !== "__all" && i.effectiveCostMethod !== filterMethod) return false;
            if (filterStrategy !== "__all" && String(i.strategyId ?? "") !== filterStrategy) return false;
            if (!q) return true;
            return (
                i.name.toLowerCase().includes(q) ||
                i.sku.toLowerCase().includes(q) ||
                (i.brandName?.toLowerCase().includes(q) ?? false) ||
                (i.categoryName?.toLowerCase().includes(q) ?? false)
            );
        });
    }, [items, search, hideEmpty, filterCategory, filterBrand, filterGroup, filterMethod, filterStrategy]);

    // Split: abnormal items go to the Needs Attention panel; clean items to the main table.
    const normalFiltered    = useMemo(() => baseFiltered.filter((i) => !attentionFor(i).needs),    [baseFiltered]);
    const attentionFiltered = useMemo(() => baseFiltered.filter((i) =>  attentionFor(i).needs),    [baseFiltered]);
    const criticalCount     = useMemo(() => attentionFiltered.filter((i) => attentionFor(i).critical).length, [attentionFiltered]);

    const hasActiveFilter =
        search.trim() !== "" ||
        hideEmpty ||
        filterCategory !== "__all" ||
        filterBrand !== "__all" ||
        filterGroup !== "__all" ||
        filterMethod !== "__all" ||
        filterStrategy !== "__all";

    // Virtualized against the office layout's <main> scroll container
    // (the office shell uses `flex-1 overflow-y-auto p-8` on <main>, so the
    // window itself doesn't scroll). We resolve that ancestor lazily — the
    // page can't import a ref to it.
    const ROW_PX = 73;
    const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
    const [tableOffsetInScroll, setTableOffsetInScroll] = useState(0);
    const tableContainerRef = useCallback((el: HTMLDivElement | null) => {
        if (!el) return;
        // Walk up to the first scrollable ancestor — the office layout's <main>.
        let p: HTMLElement | null = el.parentElement;
        while (p) {
            const oy = window.getComputedStyle(p).overflowY;
            if (oy === "auto" || oy === "scroll") break;
            p = p.parentElement;
        }
        if (p) {
            setScrollEl(p);
            setTableOffsetInScroll(el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop);
        }
    }, []);
    useLayoutEffect(() => {
        if (!scrollEl) return;
        const onResize = () => {
            const el = document.getElementById("pricing-items-table");
            if (el) setTableOffsetInScroll(el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop);
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [scrollEl]);
    const normalVirtualizer = useVirtualizer({
        count:            normalFiltered.length,
        getScrollElement: () => scrollEl,
        estimateSize:     () => ROW_PX,
        overscan:         10,
        scrollMargin:     tableOffsetInScroll,
    });

    const clearFilters = () => {
        setSearch("");
        setHideEmpty(false);
        setFilterCategory("__all");
        setFilterBrand("__all");
        setFilterGroup("__all");
        setFilterMethod("__all");
        setFilterStrategy("__all");
    };

    /**
     * Replays the server-side applyStrategy() formula using the row's current
     * edit state. Returns the live computed price + cap status so the Computed
     * column can show the in-progress value before save.
     *
     *   raw = (cost + flatPaise) × (1 + markup% / 100)
     *   rounded = round to nearest roundingPaise (or exact if 0)
     *   final = min(rounded, mrpPaise) when mrp set, else rounded
     */
    function livePreview(item: Item, e: RowEdit): {
        pricePaise:   number | null;
        cappedAtMrp:  boolean;
        markupPct:    number;
        usedCost:     number | null;
        dirty:        boolean;
    } {
        // Cost is read-only in this UI (resolver-driven) — no typed override.
        const cost: number | null = item.resolvedCostPaise;
        // Margin: typed value wins if numeric. Empty input means "no per-item
        // override" → use strategy's effective markup as visible in appliedMarkupPct.
        let markup: number = item.appliedMarkupPct;
        if (e.marginPercent.trim() !== "") {
            const typed = Number(e.marginPercent);
            if (Number.isFinite(typed)) markup = typed;
        }
        if (cost == null) {
            return { pricePaise: null, cappedAtMrp: false, markupPct: markup, usedCost: null, dirty: false };
        }
        const raw     = (cost + item.appliedFlatPaise) * (1 + markup / 100);
        const rounding = item.appliedRoundingPaise;
        const rounded = rounding > 0 ? Math.round(raw / rounding) * rounding : Math.round(raw);
        const cap     = item.mrpPaise != null && item.mrpPaise > 0 ? item.mrpPaise : null;
        const capped  = cap != null && rounded > cap;
        const finalP  = capped ? cap! : rounded;
        const dirty   = finalP !== item.computedPricePaise;
        return { pricePaise: finalP, cappedAtMrp: capped, markupPct: markup, usedCost: cost, dirty };
    }

    const editFor = (item: Item): RowEdit =>
        edits[item.id] ?? {
            costMethod:    item.costMethod ?? "__inherit",
            marginPercent: item.marginPercent != null ? String(item.marginPercent) : "",
            priceRupees:   "",
        };

    const setEdit = (id: number, item: Item, patch: Partial<RowEdit>) =>
        setEdits((prev) => ({ ...prev, [id]: { ...editFor(item), ...prev[id], ...patch } }));

    const saveRow = async (item: Item) => {
        const e = editFor(item);
        const payload: Record<string, unknown> = {};
        // Translate "__inherit" sentinel → null. Compare current edit to item value.
        const editMethod    = e.costMethod === "__inherit" ? null : e.costMethod;
        const currentMethod = item.costMethod;
        if (editMethod !== currentMethod) payload.costMethod = editMethod;
        if (e.marginPercent.trim() !== (item.marginPercent != null ? String(item.marginPercent) : "")) {
            const n = e.marginPercent.trim() === "" ? null : Number(e.marginPercent);
            if (n != null && !Number.isFinite(n)) return toast.error("Margin % must be a number");
            payload.marginPercent = n;
        }
        if (e.priceRupees.trim() !== "") {
            const n = rupeesToPaise(e.priceRupees);
            if (n == null) return toast.error("Manual price must be a valid number (e.g. 250.00)");
            if (item.mrpPaise != null && item.mrpPaise > 0 && n > item.mrpPaise) {
                return toast.error(
                    `Manual price ₹${(n / 100).toFixed(2)} exceeds MRP ₹${(item.mrpPaise / 100).toFixed(2)}.`,
                );
            }
            payload.pricePaise = n;
            payload.priceOverridden = true;
        }
        if (Object.keys(payload).length === 0) {
            toast.info("No changes");
            return;
        }
        setSavingId(item.id);
        try {
            await axios.patch(`/api/pricing-strategy/items/${item.id}`, payload);
            toast.success("Saved");
            setEdits((prev) => {
                const next = { ...prev };
                delete next[item.id];
                return next;
            });
            load();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? "Save failed" : "Save failed");
        } finally {
            setSavingId(null);
        }
    };

    const toggleOverride = async (item: Item) => {
        setSavingId(item.id);
        try {
            await axios.patch(`/api/pricing-strategy/items/${item.id}`, {
                priceOverridden: !item.priceOverridden,
            });
            toast.success(item.priceOverridden ? "Override cleared" : "Override locked");
            load();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? "Update failed" : "Update failed");
        } finally {
            setSavingId(null);
        }
    };

    const applyAll = async () => {
        if (!confirm("Recompute and write pricePaise for every non-overridden product?")) return;
        setApplying(true);
        try {
            const r = await axios.post<{ updated: number; skipped: number; errors: Array<{ productId: number; reason: string }> }>(
                "/api/pricing-strategy/apply",
                {},
            );
            toast.success(`Updated ${r.data.updated}, skipped ${r.data.skipped}${r.data.errors.length ? `, ${r.data.errors.length} errors` : ""}`);
            load();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? "Apply failed" : "Apply failed");
        } finally {
            setApplying(false);
        }
    };

    // ── Shared row renderer ──────────────────────────────────────────────────
    // Used by both the normal table and the attention panel so the row JSX
    // lives in exactly one place.
    function renderItemRow(
        item: Item,
        dataIndex: number,
    ) {
        const e    = editFor(item);
        const itemMethodValue = item.costMethod ?? "__inherit";
        const dirty =
            e.costMethod !== itemMethodValue ||
            e.marginPercent !== (item.marginPercent != null ? String(item.marginPercent) : "") ||
            e.priceRupees.trim() !== "";
        // Hint shows only when inheriting — names the resolved method.
        const methodHint =
            e.costMethod === "__inherit"
                ? `using ${COST_METHOD_LABEL[item.effectiveCostMethod]}`
                : "";
        const productLabel = [item.sku, item.brandName, item.categoryName].filter(Boolean).join(" · ");
        // Cost displayed inclusive of GST per user preference — both stored
        // values are excl-GST so we gross up at display time only. Profit
        // math below stays excl-vs-excl (still tax-adjusted).
        const costInclPaise = item.resolvedCostPaise != null && item.gstRatePct > 0
            ? Math.round(item.resolvedCostPaise * (1 + item.gstRatePct / 100))
            : item.resolvedCostPaise;
        // Profit per unit (tax-adjusted): pricePaise and resolvedCostPaise are
        // both stored excl-GST, so the difference is the realised margin after
        // input-GST netting. Live preview uses the in-progress computed price.
        const lp = livePreview(item, e);
        const effectivePricePaise = item.priceOverridden ? item.pricePaise : lp.pricePaise;
        const costForProfit = item.resolvedCostPaise;
        const profitPaise = effectivePricePaise != null && costForProfit != null
            ? effectivePricePaise - costForProfit
            : null;
        const profitPct = profitPaise != null && costForProfit && costForProfit > 0
            ? (profitPaise / costForProfit) * 100
            : null;
        return (
            <TableRow
                key={item.id}
                data-index={dataIndex}
                style={{ height: ROW_PX }}
            >
                <TableCell className="max-w-[260px]">
                    <div className="font-medium text-sm truncate" title={item.name}>{item.name}</div>
                    <div className="text-xs text-muted-foreground truncate" title={productLabel}>
                        {productLabel}
                    </div>
                </TableCell>
                <TableCell>
                    <Select
                        value={e.costMethod}
                        onValueChange={(v) => setEdit(item.id, item, { costMethod: v as RowEdit["costMethod"] })}
                    >
                        <SelectTrigger className="h-7 w-[140px] text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__inherit">
                                Inherit · {COST_METHOD_LABEL[item.strategyCostMethod ?? "WEIGHTED_AVG_COST"]}
                            </SelectItem>
                            {Object.entries(COST_METHOD_LABEL).map(([v, l]) => (
                                <SelectItem key={v} value={v}>{l}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {methodHint ? (
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate" title={methodHint}>
                            {methodHint}
                        </div>
                    ) : null}
                </TableCell>
                <TableCell className="text-right">
                    <span className="text-sm font-mono">{paise(costInclPaise)}</span>
                    {item.gstRatePct > 0 && item.resolvedCostPaise != null ? (
                        <div className="text-[10px] text-muted-foreground">
                            {paise(item.resolvedCostPaise)} excl
                        </div>
                    ) : null}
                </TableCell>
                <TableCell className="text-right">
                    <Input
                        inputMode="decimal"
                        placeholder="strategy"
                        value={e.marginPercent}
                        onChange={(ev) => setEdit(item.id, item, { marginPercent: ev.target.value })}
                        className="h-7 w-16 text-right text-xs font-mono"
                    />
                </TableCell>
                <TableCell>
                    <div className="text-xs truncate" title={item.strategyName ?? "—"}>{item.strategyName ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">
                        @{item.appliedMarkupPct.toFixed(2)}%
                    </div>
                </TableCell>
                <TableCell className="text-right">
                    {(() => {
                        const showLive = lp.dirty;
                        return (
                            <>
                                <div className="flex items-center justify-end gap-1">
                                    <span className={`text-sm font-medium ${showLive ? "text-blue-700" : ""}`}>
                                        {paise(lp.pricePaise)}
                                    </span>
                                    {lp.cappedAtMrp ? (
                                        <ShieldAlert
                                            className="size-3.5 text-amber-600"
                                            aria-label={`Capped at MRP ${paise(item.mrpPaise)}`}
                                            title={`Capped at MRP ${paise(item.mrpPaise)}`}
                                        />
                                    ) : null}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    {showLive ? <>was {paise(item.computedPricePaise)}</>
                                              : item.mrpPaise && item.mrpPaise > 0 ? <>MRP {paise(item.mrpPaise)}</>
                                              : null}
                                </div>
                            </>
                        );
                    })()}
                </TableCell>
                <TableCell className="text-right">
                    {profitPaise == null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                        <>
                            <div className="flex items-center justify-end gap-1">
                                {profitPaise < 0 ? (
                                    <TrendingDown className="size-3 text-red-600" aria-hidden />
                                ) : null}
                                <span className={`text-sm font-mono ${profitPaise < 0 ? "text-red-700" : "text-emerald-700"}`}>
                                    {paise(profitPaise)}
                                </span>
                            </div>
                            {profitPct != null ? (
                                <div className={`text-[10px] ${profitPaise < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                    {profitPct.toFixed(1)}%
                                </div>
                            ) : null}
                        </>
                    )}
                </TableCell>
                <TableCell className="text-right">
                    <span className="text-sm font-mono">{paise(item.pricePaise)}</span>
                    {item.priceOverridden ? (
                        <Lock className="size-3 inline ml-1 text-muted-foreground" aria-label="Manual override" />
                    ) : null}
                </TableCell>
                <TableCell className="text-right">
                    <Input
                        inputMode="decimal"
                        placeholder="₹ 0.00"
                        value={e.priceRupees}
                        onChange={(ev) => setEdit(item.id, item, { priceRupees: ev.target.value })}
                        className="h-7 w-24 text-right text-xs font-mono"
                    />
                </TableCell>
                <TableCell className="text-right space-x-1 whitespace-nowrap">
                    {dirty ? (
                        <Button
                            type="button"
                            size="icon-sm"
                            aria-label="Save"
                            onClick={() => saveRow(item)}
                            disabled={savingId === item.id}
                        >
                            <Save className="size-4" />
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={item.priceOverridden ? "Clear override" : "Lock manual"}
                        onClick={() => toggleOverride(item)}
                        disabled={savingId === item.id}
                    >
                        {item.priceOverridden ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                    </Button>
                </TableCell>
            </TableRow>
        );
    }

    function TableColumns() {
        return (
            <TableRow>
                <TableHead className="text-xs">Product</TableHead>
                <TableHead className="text-xs">Cost method</TableHead>
                <TableHead className="text-right text-xs">Cost (₹ incl GST)</TableHead>
                <TableHead className="text-right text-xs">Margin %</TableHead>
                <TableHead className="text-xs">Strategy</TableHead>
                <TableHead className="text-right text-xs">Computed</TableHead>
                <TableHead className="text-right text-xs">Profit</TableHead>
                <TableHead className="text-right text-xs">Current</TableHead>
                <TableHead className="text-right text-xs">Manual price (₹)</TableHead>
                <TableHead className="text-right w-20" />
            </TableRow>
        );
    }

    return (
        <div className="space-y-3">

            {/* ── Header row ────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        <Boxes className="size-5" aria-hidden />
                        Items
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {loading ? "Loading…" : (
                            <>
                                <strong>{normalFiltered.length}</strong> ready
                                {attentionFiltered.length > 0
                                    ? <> · <span className={criticalCount > 0 ? "text-red-700 font-medium" : "text-amber-700 font-medium"}>{attentionFiltered.length} need attention</span></>
                                    : <> · <span className="text-green-700">all complete</span></>
                                }
                            </>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={load}>
                        <RefreshCw className="size-4" />
                        Reload
                    </Button>
                    <Button type="button" size="sm" onClick={applyAll} disabled={applying}>
                        <Wand2 className="size-4" />
                        Apply to non-overridden
                    </Button>
                </div>
            </div>

            {/* ── Filter card (voucher-register style: labels above) ────── */}
            <div className="flex flex-wrap items-end gap-3 rounded-sm border border-border bg-card p-3">
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Search</label>
                    <Input
                        placeholder="Name / SKU / brand…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 w-56 text-xs"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Category</label>
                    <Select value={filterCategory} onValueChange={setFilterCategory}>
                        <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">All categories</SelectItem>
                            {uniqueCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Brand</label>
                    <Select value={filterBrand} onValueChange={setFilterBrand}>
                        <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Brand" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">All brands</SelectItem>
                            {uniqueBrands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Group</label>
                    <Select value={filterGroup} onValueChange={setFilterGroup}>
                        <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Group" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">All groups</SelectItem>
                            {uniqueGroups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Cost method</label>
                    <Select value={filterMethod} onValueChange={setFilterMethod}>
                        <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Method" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">All methods</SelectItem>
                            {Object.entries(COST_METHOD_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Strategy</label>
                    <Select value={filterStrategy} onValueChange={setFilterStrategy}>
                        <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Strategy" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">All strategies</SelectItem>
                            {uniqueStrategies.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer select-none h-8 text-xs">
                    <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
                    Hide empty
                </label>
                {hasActiveFilter ? (
                    <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="h-8">
                        <X className="size-3.5" />
                        Clear
                    </Button>
                ) : null}
            </div>

            {/* ── Needs Attention banner (no expand — link to dedicated page) */}
            {!loading && attentionFiltered.length > 0 ? (
                <Link
                    href="/office/pricing-strategy/needs-attention"
                    className="flex items-center gap-2 rounded-sm border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100/60 transition-colors dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
                >
                    <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
                    <span className="font-medium">
                        Needs Attention — {attentionFiltered.length} item{attentionFiltered.length !== 1 ? "s" : ""}
                    </span>
                    {criticalCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 font-semibold">
                            <AlertCircle className="size-3.5" aria-hidden />
                            {criticalCount} blocked (no cost)
                        </span>
                    ) : null}
                    <span className="ml-auto inline-flex items-center gap-1 text-xs font-normal">
                        Fix on Needs Attention page
                        <ArrowRight className="size-3.5" aria-hidden />
                    </span>
                </Link>
            ) : null}

            {/* ── Main table (page-scrolled, window-virtualized) ─────────── */}
            <div id="pricing-items-table" ref={tableContainerRef} className="rounded-sm border border-border bg-card overflow-hidden">
                <Table>
                    <TableHeader className="bg-muted/40 sticky top-0 z-10">
                        <TableColumns />
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableLoadingRow colSpan={10} />
                        ) : normalFiltered.length === 0 ? (
                            <TableEmptyRow colSpan={10} message={
                                items.length > 0 && attentionFiltered.length === items.length
                                    ? "All products need attention — see the banner above."
                                    : "No products match."
                            } />
                        ) : (() => {
                            const vi    = normalVirtualizer.getVirtualItems();
                            const total = normalVirtualizer.getTotalSize();
                            const padTop = vi.length > 0 ? vi[0].start - tableOffsetInScroll : 0;
                            const padBot = vi.length > 0 ? (total + tableOffsetInScroll) - vi[vi.length - 1].end : 0;
                            return (
                                <>
                                    {padTop > 0 ? <tr aria-hidden><td colSpan={10} style={{ height: `${padTop}px` }} /></tr> : null}
                                    {vi.map((v) => renderItemRow(normalFiltered[v.index], v.index))}
                                    {padBot > 0 ? <tr aria-hidden><td colSpan={10} style={{ height: `${padBot}px` }} /></tr> : null}
                                </>
                            );
                        })()}
                    </TableBody>
                </Table>
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>Cost</strong> is resolved per the row&apos;s cost method (opening + purchases) — read-only here; manual entry lives on the <em>Needs Attention</em> page.{" "}
                <strong>Computed</strong> = (cost + flat) × (1 + markup%), rounded, capped at MRP.{" "}
                <strong>Profit</strong> = price − cost (both excl-GST, so tax-adjusted).{" "}
                <strong>Manual price</strong> sets <code>pricePaise</code> directly and locks the row.
            </p>
        </div>
    );
}
