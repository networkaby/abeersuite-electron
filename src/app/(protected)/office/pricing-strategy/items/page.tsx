"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import axios from "axios";
import { toast } from "sonner";
import { Boxes, Save, Wand2, Lock, Unlock, RefreshCw, ShieldAlert, AlertTriangle, AlertCircle, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
    /** Rupees string entered by user (e.g. "296.61"). Sent ×100 to API as costPaise. */
    costRupees:    string;
    /** Rupees string entered by user (e.g. "296.61"). Sent ×100 to API as stdCostPaise. */
    stdCostRupees: string;
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

/** Format paise as a rupees string for pre-filling inputs (no ₹ symbol). */
function paiseToRupeesStr(p: number | null): string {
    if (p == null) return "";
    return (p / 100).toFixed(2);
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
    const [showAttentionPanel,  setShowAttentionPanel]  = useState(true);
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

    // ── Virtual scrolling ────────────────────────────────────────────────────
    // One virtualizer per scroll viewport. estimateSize is approximate;
    // react-virtual auto-measures with measureElement.
    const normalParentRef    = useRef<HTMLDivElement>(null);
    const normalVirtualizer  = useVirtualizer({
        count:            normalFiltered.length,
        getScrollElement: () => normalParentRef.current,
        estimateSize:     () => 72,
        overscan:         10,
    });
    const attentionParentRef   = useRef<HTMLDivElement>(null);
    const attentionVirtualizer = useVirtualizer({
        count:            attentionFiltered.length,
        getScrollElement: () => attentionParentRef.current,
        estimateSize:     () => 72,
        overscan:         5,
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
        // Cost: typed rupee value wins if valid. Empty input → fall back to resolved.
        let cost: number | null = item.resolvedCostPaise;
        const typedCostPaise = rupeesToPaise(e.costRupees);
        if (typedCostPaise !== null) cost = typedCostPaise;
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
            costRupees:    paiseToRupeesStr(item.lastPurchasePaise),
            stdCostRupees: paiseToRupeesStr(item.stdCostPaise),
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
        if (e.stdCostRupees !== paiseToRupeesStr(item.stdCostPaise)) {
            const n = e.stdCostRupees.trim() === "" ? null : rupeesToPaise(e.stdCostRupees);
            if (e.stdCostRupees.trim() !== "" && n == null) return toast.error("Std cost must be a valid number (e.g. 250.00)");
            payload.stdCostPaise = n;
        }
        if (e.costRupees !== paiseToRupeesStr(item.lastPurchasePaise)) {
            const n = e.costRupees.trim() === "" ? null : rupeesToPaise(e.costRupees);
            if (e.costRupees.trim() !== "" && n == null) return toast.error("Cost must be a valid number (e.g. 250.00)");
            payload.costPaise = n;
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
        measureElement: (el: Element | null) => void,
        showAlertCol: boolean,
    ) {
        const e    = editFor(item);
        const att  = attentionFor(item);
        const itemMethodValue = item.costMethod ?? "__inherit";
        const dirty =
            e.costMethod !== itemMethodValue ||
            e.marginPercent !== (item.marginPercent != null ? String(item.marginPercent) : "") ||
            e.stdCostRupees !== paiseToRupeesStr(item.stdCostPaise) ||
            e.costRupees !== paiseToRupeesStr(item.lastPurchasePaise) ||
            e.priceRupees.trim() !== "";
        return (
            <TableRow
                key={item.id}
                data-index={dataIndex}
                ref={measureElement}
            >
                {showAlertCol ? (
                    <TableCell className="w-8">
                        <span
                            title={`Missing: ${att.missing.join(", ")}`}
                            className={att.critical ? "text-red-700" : "text-amber-700"}
                        >
                            {att.critical ? (
                                <AlertCircle className="size-4" aria-label="Critical — no cost" />
                            ) : (
                                <AlertTriangle className="size-4" aria-label="Needs attention" />
                            )}
                        </span>
                    </TableCell>
                ) : null}
                <TableCell>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">
                        {item.sku}
                        {item.brandName ? ` · ${item.brandName}` : ""}
                        {item.categoryName ? ` · ${item.categoryName}` : ""}
                    </div>
                </TableCell>
                <TableCell>
                    <Select
                        value={e.costMethod}
                        onValueChange={(v) => setEdit(item.id, item, { costMethod: v as RowEdit["costMethod"] })}
                    >
                        <SelectTrigger className="h-8 w-[180px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__inherit">
                                Inherit{item.strategyCostMethod ? ` (${COST_METHOD_LABEL[item.strategyCostMethod]})` : " (Weighted Avg)"}
                            </SelectItem>
                            {Object.entries(COST_METHOD_LABEL).map(([v, l]) => (
                                <SelectItem key={v} value={v}>{l}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {e.costMethod === "__inherit" ? (
                        <div className="text-xs text-muted-foreground mt-1">
                            using {COST_METHOD_LABEL[item.effectiveCostMethod]}
                        </div>
                    ) : null}
                    {item.resolvedCostFallback ? (
                        <div className="text-xs text-amber-600 mt-1">{item.resolvedCostFallback}</div>
                    ) : null}
                </TableCell>
                <TableCell className="text-right">
                    <Input
                        inputMode="decimal"
                        placeholder="₹ e.g. 296.61"
                        value={e.costRupees}
                        onChange={(ev) => setEdit(item.id, item, { costRupees: ev.target.value })}
                        className="h-8 w-28 text-right ml-auto"
                    />
                    <div className="text-xs text-muted-foreground mt-0.5">
                        resolves to {paise(item.resolvedCostPaise)}
                    </div>
                </TableCell>
                <TableCell className="text-right">
                    <Input
                        inputMode="decimal"
                        placeholder="strategy"
                        value={e.marginPercent}
                        onChange={(ev) => setEdit(item.id, item, { marginPercent: ev.target.value })}
                        className="h-8 w-20 text-right"
                    />
                </TableCell>
                <TableCell>
                    <span className="text-xs">{item.strategyName ?? "—"}</span>
                    <div className="text-xs text-muted-foreground">
                        @{item.appliedMarkupPct.toFixed(2)}%
                    </div>
                </TableCell>
                <TableCell className="text-right font-medium">
                    {(() => {
                        const lp = livePreview(item, e);
                        const showLive = lp.dirty;
                        return (
                            <>
                                <div className="flex items-center justify-end gap-1">
                                    <span className={showLive ? "text-blue-700" : undefined}>
                                        {paise(lp.pricePaise)}
                                    </span>
                                    {lp.cappedAtMrp ? (
                                        <Badge
                                            variant="outline"
                                            className="text-amber-700 border-amber-500"
                                            title={`Cost+margin exceeds MRP — capped to ${paise(item.mrpPaise)}.`}
                                        >
                                            <ShieldAlert className="size-3 mr-1" />
                                            MRP cap
                                        </Badge>
                                    ) : null}
                                    {showLive ? (
                                        <Badge
                                            variant="outline"
                                            className="text-blue-700 border-blue-400"
                                            title={`Saved: ${paise(item.computedPricePaise)}. Updates on Save.`}
                                        >
                                            preview
                                        </Badge>
                                    ) : null}
                                </div>
                                {item.mrpPaise != null && item.mrpPaise > 0 ? (
                                    <div className="text-xs text-muted-foreground">
                                        MRP {paise(item.mrpPaise)}
                                    </div>
                                ) : null}
                                {showLive ? (
                                    <div className="text-xs text-muted-foreground">
                                        was {paise(item.computedPricePaise)}
                                    </div>
                                ) : null}
                            </>
                        );
                    })()}
                </TableCell>
                <TableCell className="text-right">
                    {paise(item.pricePaise)}
                    {item.priceOverridden ? (
                        <Badge variant="outline" className="ml-2">
                            <Lock className="size-3 mr-1" />
                            manual
                        </Badge>
                    ) : null}
                </TableCell>
                <TableCell className="text-right">
                    <Input
                        inputMode="decimal"
                        placeholder="₹ e.g. 450.00"
                        value={e.priceRupees}
                        onChange={(ev) => setEdit(item.id, item, { priceRupees: ev.target.value })}
                        className="h-8 w-28 text-right"
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

    // Reusable table header — normal table omits the alert column.
    function TableColumns({ showAlertCol }: { showAlertCol: boolean }) {
        return (
            <TableRow>
                {showAlertCol ? <TableHead className="w-8" /> : null}
                <TableHead>Product</TableHead>
                <TableHead>Cost method</TableHead>
                <TableHead className="text-right">Cost (₹)</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">Computed</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Manual price (₹)</TableHead>
                <TableHead className="text-right" />
            </TableRow>
        );
    }

    return (
        <div className="space-y-6">

            {/* ── Toolbar ─────────────────────────────────────────────────── */}
            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-wrap">
                        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                            <Boxes className="size-5" aria-hidden />
                            Items
                        </h2>
                        <span className="text-xs text-muted-foreground">
                            {loading ? "Loading…" : (
                                <>
                                    <strong>{normalFiltered.length}</strong> ready
                                    {attentionFiltered.length > 0
                                        ? <> · <span className={criticalCount > 0 ? "text-red-700 font-medium" : "text-amber-700 font-medium"}>{attentionFiltered.length} need attention</span></>
                                        : <> · <span className="text-green-700">all complete</span></>
                                    }
                                </>
                            )}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" onClick={load}>
                            <RefreshCw className="size-4" />
                            Reload
                        </Button>
                        <Button type="button" onClick={applyAll} disabled={applying}>
                            <Wand2 className="size-4" />
                            Apply to non-overridden
                        </Button>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 border border-border bg-muted/30 p-2">
                    <Input
                        placeholder="Search name / SKU / brand…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 w-64"
                    />
                    <Select value={filterCategory} onValueChange={setFilterCategory}>
                        <SelectTrigger className="h-8 w-[180px]">
                            <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">All categories</SelectItem>
                            {uniqueCategories.map((c) => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={filterBrand} onValueChange={setFilterBrand}>
                        <SelectTrigger className="h-8 w-[180px]">
                            <SelectValue placeholder="Brand" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">All brands</SelectItem>
                            {uniqueBrands.map((b) => (
                                <SelectItem key={b} value={b}>{b}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={filterGroup} onValueChange={setFilterGroup}>
                        <SelectTrigger className="h-8 w-[180px]">
                            <SelectValue placeholder="Group" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">All groups</SelectItem>
                            {uniqueGroups.map((g) => (
                                <SelectItem key={g} value={g}>{g}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={filterMethod} onValueChange={setFilterMethod}>
                        <SelectTrigger className="h-8 w-[180px]">
                            <SelectValue placeholder="Cost method" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">All methods</SelectItem>
                            {Object.entries(COST_METHOD_LABEL).map(([v, l]) => (
                                <SelectItem key={v} value={v}>{l}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={filterStrategy} onValueChange={setFilterStrategy}>
                        <SelectTrigger className="h-8 w-[200px]">
                            <SelectValue placeholder="Strategy" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">All strategies</SelectItem>
                            {uniqueStrategies.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <label className="text-xs flex items-center gap-1.5 cursor-pointer select-none ml-2">
                        <input
                            type="checkbox"
                            checked={hideEmpty}
                            onChange={(e) => setHideEmpty(e.target.checked)}
                        />
                        Hide empty
                    </label>
                    {hasActiveFilter ? (
                        <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="ml-auto h-7">
                            <X className="size-3.5" />
                            Clear filters
                        </Button>
                    ) : null}
                </div>
            </div>

            {/* ── Needs Attention panel ────────────────────────────────────── */}
            {!loading && attentionFiltered.length > 0 ? (
                <div className="border border-amber-300 bg-amber-50/40 rounded-sm">
                    {/* Collapsible header */}
                    <button
                        type="button"
                        onClick={() => setShowAttentionPanel((v) => !v)}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-amber-900 hover:bg-amber-100/60 transition-colors"
                    >
                        {showAttentionPanel
                            ? <ChevronDown className="size-4 shrink-0" aria-hidden />
                            : <ChevronRight className="size-4 shrink-0" aria-hidden />
                        }
                        <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
                        Needs Attention — {attentionFiltered.length} item{attentionFiltered.length !== 1 ? "s" : ""}
                        {criticalCount > 0 ? (
                            <span className="ml-2 inline-flex items-center gap-1 text-red-700 font-semibold">
                                <AlertCircle className="size-3.5" aria-hidden />
                                {criticalCount} blocked (no cost)
                            </span>
                        ) : null}
                        <span className="ml-auto text-xs text-amber-700 font-normal">
                            Fill in the missing fields below, then Save — the row will move to the main table.
                        </span>
                    </button>

                    {showAttentionPanel ? (() => {
                        const vi     = attentionVirtualizer.getVirtualItems();
                        const total  = attentionVirtualizer.getTotalSize();
                        const padTop = vi.length > 0 ? vi[0].start : 0;
                        const padBot = vi.length > 0 ? total - vi[vi.length - 1].end : 0;
                        return (
                            <div
                                ref={attentionParentRef}
                                className="max-h-[40vh] overflow-auto border-t border-amber-200"
                            >
                                <Table>
                                    <TableHeader className="sticky top-0 z-10 bg-amber-50">
                                        <TableColumns showAlertCol />
                                    </TableHeader>
                                    <TableBody>
                                        {attentionFiltered.length === 0 ? (
                                            <TableEmptyRow colSpan={10} message="No items match filters." />
                                        ) : (
                                            <>
                                                {padTop > 0 ? <tr aria-hidden><td colSpan={10} style={{ height: `${padTop}px` }} /></tr> : null}
                                                {vi.map((v) => renderItemRow(
                                                    attentionFiltered[v.index],
                                                    v.index,
                                                    attentionVirtualizer.measureElement,
                                                    true,
                                                ))}
                                                {padBot > 0 ? <tr aria-hidden><td colSpan={10} style={{ height: `${padBot}px` }} /></tr> : null}
                                            </>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        );
                    })() : null}
                </div>
            ) : null}

            {/* ── Main clean table ─────────────────────────────────────────── */}
            <div ref={normalParentRef} className="max-h-[70vh] overflow-auto border border-border">
                <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableColumns showAlertCol={false} />
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableLoadingRow colSpan={9} />
                        ) : normalFiltered.length === 0 ? (
                            <TableEmptyRow colSpan={9} message={
                                items.length > 0 && attentionFiltered.length === items.length
                                    ? "All products need attention — see the panel above."
                                    : "No products match."
                            } />
                        ) : (() => {
                            const vi     = normalVirtualizer.getVirtualItems();
                            const total  = normalVirtualizer.getTotalSize();
                            const padTop = vi.length > 0 ? vi[0].start : 0;
                            const padBot = vi.length > 0 ? total - vi[vi.length - 1].end : 0;
                            return (
                                <>
                                    {padTop > 0 ? <tr aria-hidden><td colSpan={9} style={{ height: `${padTop}px` }} /></tr> : null}
                                    {vi.map((v) => renderItemRow(
                                        normalFiltered[v.index],
                                        v.index,
                                        normalVirtualizer.measureElement,
                                        false,
                                    ))}
                                    {padBot > 0 ? <tr aria-hidden><td colSpan={9} style={{ height: `${padBot}px` }} /></tr> : null}
                                </>
                            );
                        })()}
                    </TableBody>
                </Table>
            </div>

            <p className="text-xs text-muted-foreground">
                <strong>Cost (₹)</strong> writes to InvProduct.costPaise — the last-purchase-cost snapshot.
                The resolver uses it directly for LAST_PURCHASE_COST and as a fallback for every other method
                when no purchase history exists. <em>Resolves to</em> shows the value actually fed into the formula.{" "}
                <strong>Computed</strong> = (cost + strategy flat) × (1 + markup%), rounded, capped at MRP.{" "}
                <strong>Manual price</strong> sets pricePaise directly and locks the row — Apply will skip it.
                Items missing cost, MRP, or a saved price are held in the <em>Needs Attention</em> panel above
                until those fields are filled in and saved.
            </p>
        </div>
    );
}
