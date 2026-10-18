"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import {
    AlertCircle, AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown,
    ChevronDown, ChevronRight, Pencil, RefreshCw, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TableScrollArea } from "@/shared/components/TableScrollArea";
import type { PricingItem } from "@/modules/pricing-strategy/lib/pricingItem";
import { InvProductDialog } from "@/modules/inventory/components/InvProductDialog";
import { ScrollBar } from "@/components/ui/scroll-area";

const ROW_GRID = "grid gap-2 items-center grid-cols-[minmax(180px,1fr)_84px_84px_84px_72px]";

// ── helpers ────────────────────────────────────────────────────────────────────

type View = "group" | "category" | "brand" | "item";
type SortKey = "name" | "group" | "category" | "brand" | "cost" | "mrp";
type SortDir = "asc" | "desc";

function groupKey(item: PricingItem, view: View): string {
    if (view === "category") return item.categoryName ?? "— No category —";
    if (view === "brand") return item.brandName ?? "— No brand —";
    // view === "item" never uses groupKey; fall through to groupName for safety.
    return item.groupName ?? "— No group —";
}

/** Format paise → ₹ string (excl = raw paise/100, incl = paise/100 × (1+gst)). */
function fmt(paise: number | null, gstRatePct = 0): string {
    if (paise == null) return "—";
    const v = gstRatePct > 0 ? (paise / 100) * (1 + gstRatePct / 100) : paise / 100;
    return `₹${v.toFixed(2)}`;
}

// ── linked-input helpers ───────────────────────────────────────────────────────

function exclToIncl(excl: string, gst: number): string {
    const v = parseFloat(excl);
    if (!isFinite(v)) return "";
    return gst > 0 ? (v * (1 + gst / 100)).toFixed(2) : v.toFixed(2);
}

function inclToExcl(incl: string, gst: number): string {
    const v = parseFloat(incl);
    if (!isFinite(v)) return "";
    return gst > 0 ? (v / (1 + gst / 100)).toFixed(2) : v.toFixed(2);
}

// ── attention ──────────────────────────────────────────────────────────────────

type AttentionType = "cost" | "mrp";

function attention(item: PricingItem): AttentionType[] {
    const out: AttentionType[] = [];
    if (item.resolvedCostPaise == null) out.push("cost");
    if (item.mrpPaise == null || item.mrpPaise <= 0) out.push("mrp");
    return out;
}

// ── types ──────────────────────────────────────────────────────────────────────

type RowEdit = {
    /** Cost – stored as excl paise; both fields kept in sync. */
    costExcl: string;
    costIncl: string;
    /** MRP – stored as incl paise (Indian sticker price). */
    mrpIncl: string;
};

function emptyEdit(item: PricingItem): RowEdit {
    const gst = item.gstRatePct;

    // Cost: lastPurchasePaise is excl paise
    let costExcl = "";
    let costIncl = "";
    if (item.lastPurchasePaise != null) {
        costExcl = (item.lastPurchasePaise / 100).toFixed(2);
        costIncl = exclToIncl(costExcl, gst);
    }

    // MRP: mrpPaise is incl paise
    let mrpIncl = "";
    if (item.mrpPaise != null && item.mrpPaise > 0) {
        mrpIncl = (item.mrpPaise / 100).toFixed(2);
    }

    return { costExcl, costIncl, mrpIncl };
}

// ── sortable header cell (item-wise view) ─────────────────────────────────────

function SortHeader({
    k, label, sortKey, sortDir, onToggle, align = "left",
}: {
    k: SortKey;
    label: string;
    sortKey: SortKey;
    sortDir: SortDir;
    onToggle: (k: SortKey) => void;
    align?: "left" | "right";
}) {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
        <th className={`px-2 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
            <button
                type="button"
                onClick={() => onToggle(k)}
                className={`inline-flex items-center gap-1 uppercase hover:text-foreground ${active ? "text-foreground" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
            >
                <span>{label}</span>
                <Icon size={11} className={active ? "" : "opacity-40"} />
            </button>
        </th>
    );
}

// ── component ─────────────────────────────────────────────────────────────────

export default function NeedsAttentionPage() {
    const [items, setItems] = useState<PricingItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<View>("group");
    const [showCost, setShowCost] = useState(true);
    const [showMrp, setShowMrp] = useState(true);
    const [sortKey, setSortKey] = useState<SortKey>("name");
    const [sortDir, setSortDir] = useState<SortDir>("asc");
    const toggleSort = (k: SortKey) => {
        if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else { setSortKey(k); setSortDir("asc"); }
    };

    const [edits, setEdits] = useState<Record<number, RowEdit>>({});
    const [savingId, setSavingId] = useState<number | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const [editProductId, setEditProductId] = useState<number | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    const openEdit = (id: number) => {
        setEditProductId(id);
        setDialogOpen(true);
    };

    const load = () => {
        setLoading(true);
        axios
            .get<PricingItem[]>("/api/pricing-strategy/items?onlyAttention=1")
            .then((r) => {
                setItems(r.data);
                const keys = new Set(r.data.map((i) => groupKey(i, view)));
                setExpanded(keys);
            })
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once on mount
    // Live refresh swaps the rows only — no spinner, groups stay as opened, typed edits stay.
    useRealtimeTopics(["catalogue", "stock"], () => {
        axios.get<PricingItem[]>("/api/pricing-strategy/items?onlyAttention=1")
            .then((r) => setItems(r.data))
            .catch(() => {});
    });

    const prevView = useRef(view);
    useEffect(() => {
        if (prevView.current !== view) {
            prevView.current = view;
            const keys = new Set(items.map((i) => groupKey(i, view)));
            setExpanded(keys);
        }
    }, [view, items]);

    // ── counts ─────────────────────────────────────────────────────────────────

    const costCount = useMemo(() => items.filter((i) => i.resolvedCostPaise == null).length, [items]);
    const mrpCount = useMemo(() => items.filter((i) => !i.mrpPaise || i.mrpPaise <= 0).length, [items]);

    // ── filtered + grouped ────────────────────────────────────────────────────

    const filtered = useMemo(() => items.filter((i) => {
        const att = attention(i);
        if (showCost && att.includes("cost")) return true;
        if (showMrp && att.includes("mrp")) return true;
        return false;
    }), [items, showCost, showMrp]);

    const grouped = useMemo(() => {
        const map = new Map<string, PricingItem[]>();
        for (const i of filtered) {
            const k = groupKey(i, view);
            const arr = map.get(k);
            if (arr) arr.push(i); else map.set(k, [i]);
        }
        return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    }, [filtered, view]);

    // Flat sortable list for the Item-wise view. Numeric nulls sort to the
    // top in ASC (-Infinity) so missing-data rows bubble up — that's the
    // whole point of this page.
    const sortedItems = useMemo(() => {
        const arr = filtered.slice();
        const dir = sortDir === "asc" ? 1 : -1;
        const num = (n: number | null | undefined) => (n == null ? -Infinity : n);
        arr.sort((a, b) => {
            switch (sortKey) {
                case "name": return dir * a.name.localeCompare(b.name);
                case "group": return dir * (a.groupName ?? "").localeCompare(b.groupName ?? "");
                case "category": return dir * (a.categoryName ?? "").localeCompare(b.categoryName ?? "");
                case "brand": return dir * (a.brandName ?? "").localeCompare(b.brandName ?? "");
                case "cost": return dir * (num(a.resolvedCostPaise) - num(b.resolvedCostPaise));
                case "mrp": return dir * (num(a.mrpPaise) - num(b.mrpPaise));
            }
        });
        return arr;
    }, [filtered, sortKey, sortDir]);

    // ── edit helpers ──────────────────────────────────────────────────────────

    const editFor = (item: PricingItem): RowEdit => edits[item.id] ?? emptyEdit(item);

    const setEdit = (item: PricingItem, patch: Partial<RowEdit>) =>
        setEdits((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] ?? emptyEdit(item)), ...patch } }));

    const onCostExclChange = (item: PricingItem, val: string) =>
        setEdit(item, { costExcl: val, costIncl: exclToIncl(val, item.gstRatePct) });

    const onCostInclChange = (item: PricingItem, val: string) =>
        setEdit(item, { costIncl: val, costExcl: inclToExcl(val, item.gstRatePct) });

    const onMrpInclChange = (item: PricingItem, val: string) =>
        setEdit(item, { mrpIncl: val });

    function isDirty(item: PricingItem): boolean {
        const e = editFor(item);
        const base = emptyEdit(item);
        return e.costExcl !== base.costExcl || e.mrpIncl !== base.mrpIncl;
    }

    // ── save row ──────────────────────────────────────────────────────────────

    const saveRow = async (item: PricingItem) => {
        const e = editFor(item);
        const base = emptyEdit(item);
        const payload: Record<string, unknown> = {};

        if (e.costExcl !== base.costExcl && e.costExcl.trim() !== "") {
            const v = parseFloat(e.costExcl);
            if (!isFinite(v) || v < 0) return toast.error("Invalid opening rate");
            // Lands on InvProduct.openingRate (Tally-style opening cost) and
            // mirrors into costPaise on the server side so the cost resolver
            // picks it up immediately.
            payload.openingRatePaise = Math.round(v * 100);
        }
        if (e.mrpIncl !== base.mrpIncl && e.mrpIncl.trim() !== "") {
            const v = parseFloat(e.mrpIncl);
            if (!isFinite(v) || v < 0) return toast.error("Invalid MRP");
            payload.mrpPaise = Math.round(v * 100);
        }

        if (Object.keys(payload).length === 0) return toast.info("No changes");

        setSavingId(item.id);
        try {
            await axios.patch(`/api/pricing-strategy/items/${item.id}`, payload);
            toast.success("Saved");
            setEdits((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
            load();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? "Save failed" : "Save failed");
        } finally {
            setSavingId(null);
        }
    };

    // ── toggle group ──────────────────────────────────────────────────────────

    const toggleGroup = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <div className="flex h-full flex-col gap-2 px-6 pb-6">

            {/* header */}
            <div className="flex flex-none flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        <AlertTriangle className="size-5 text-amber-600" aria-hidden />
                        Needs Attention
                    </h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {loading
                            ? "Loading…"
                            : `${items.length} product${items.length !== 1 ? "s" : ""} need data. Showing ${filtered.length}.`}
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    <RefreshCw className="size-4" />
                    Reload
                </Button>
            </div>

            {/* view toggle + filter pills */}
            <div className="flex flex-none flex-wrap items-center gap-2 border border-border bg-muted/30 p-2">
                <span className="text-xs text-muted-foreground font-medium mr-1">View:</span>
                {(["group", "category", "brand", "item"] as View[]).map((v) => (
                    <button
                        key={v}
                        onClick={() => setView(v)}
                        className={`text-xs px-2.5 py-1 border rounded transition-colors ${view === v
                                ? "bg-foreground text-background border-foreground"
                                : "border-border hover:bg-muted"
                            }`}
                    >
                        {v === "item" ? "Item-wise" : v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                ))}

                <span className="border-l border-border h-5 mx-1" />

                <span className="text-xs text-muted-foreground font-medium mr-1">Show:</span>
                <button
                    onClick={() => setShowCost((p) => !p)}
                    className={`text-xs px-2.5 py-1 border rounded transition-colors ${showCost
                            ? "bg-red-100 border-red-400 text-red-800"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                >
                    <AlertCircle className="size-3 inline mr-1" />
                    No cost ({costCount})
                </button>
                <button
                    onClick={() => setShowMrp((p) => !p)}
                    className={`text-xs px-2.5 py-1 border rounded transition-colors ${showMrp
                            ? "bg-amber-100 border-amber-400 text-amber-800"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                >
                    <AlertTriangle className="size-3 inline mr-1" />
                    No MRP ({mrpCount})
                </button>
            </div>

            {/* groups */}
            {loading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
            ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                    All products have cost and MRP set. ✓
                </p>
            ) : view === "item" ? (
                <TableScrollArea>
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-muted/40 backdrop-blur-sm">
                            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                                <SortHeader k="name"     label="Product"      sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                                <SortHeader k="group"    label="Group"        sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                                <SortHeader k="category" label="Category"     sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                                <SortHeader k="brand"    label="Brand"        sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                                <SortHeader k="cost"     label="Opening excl" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} align="right" />
                                <th className="px-2 py-2 text-right font-medium uppercase">Opening incl</th>
                                <SortHeader k="mrp"      label="MRP"          sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} align="right" />
                                <th className="px-2 py-2 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {sortedItems.map((item) => {
                                const att = attention(item);
                                const e = editFor(item);
                                const dirty = isDirty(item);
                                const gst = item.gstRatePct;
                                const savedCostExcl = item.resolvedCostPaise != null ? fmt(item.resolvedCostPaise) : null;
                                const savedCostIncl = item.resolvedCostPaise != null ? fmt(item.resolvedCostPaise, gst) : null;
                                const savedMrpIncl = item.mrpPaise != null && item.mrpPaise > 0 ? fmt(item.mrpPaise) : null;

                                return (
                                    <tr
                                        key={item.id}
                                        className={att.includes("cost") ? "bg-red-50/40 hover:bg-red-100/40 dark:bg-red-950/10" : "hover:bg-muted/30"}
                                    >
                                        {/* product */}
                                        <td className="px-2 py-1.5 max-w-[220px] align-top">
                                            <div className="text-sm font-medium leading-tight truncate" title={item.name}>{item.name}</div>
                                            <div className="text-xs text-muted-foreground mt-0.5 font-mono truncate">{item.sku}</div>
                                            <div className="flex flex-wrap items-center gap-1 mt-1">
                                                {gst > 0 && (
                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-normal">
                                                        GST {gst}%
                                                    </Badge>
                                                )}
                                                {att.includes("cost") && (
                                                    <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">no cost</Badge>
                                                )}
                                                {att.includes("mrp") && (
                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-amber-700 border-amber-400 bg-amber-50">
                                                        no MRP
                                                    </Badge>
                                                )}
                                            </div>
                                        </td>

                                        {/* group / category / brand */}
                                        <td className="px-2 py-1.5 text-xs text-muted-foreground align-top max-w-[120px]">
                                            <span className="block truncate" title={item.groupName ?? "—"}>
                                                {item.groupName ?? <span className="text-muted-foreground/65">—</span>}
                                            </span>
                                        </td>
                                        <td className="px-2 py-1.5 text-xs text-muted-foreground align-top max-w-[140px]">
                                            <span className="block truncate" title={item.categoryName ?? "—"}>
                                                {item.categoryName ?? <span className="text-muted-foreground/65">—</span>}
                                            </span>
                                        </td>
                                        <td className="px-2 py-1.5 text-xs text-muted-foreground align-top max-w-[100px]">
                                            <span className="block truncate" title={item.brandName ?? "—"}>
                                                {item.brandName ?? <span className="text-muted-foreground/65">—</span>}
                                            </span>
                                        </td>

                                        {/* cost excl */}
                                        <td className="px-2 py-1.5 align-top text-right">
                                            <Input
                                                inputMode="decimal"
                                                placeholder={savedCostExcl ?? "—"}
                                                value={e.costExcl}
                                                onChange={(ev) => onCostExclChange(item, ev.target.value)}
                                                className="h-8 w-20 text-right text-sm font-mono"
                                            />
                                            {savedCostExcl && (
                                                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                                                    {savedCostExcl}
                                                </div>
                                            )}
                                        </td>

                                        {/* cost incl */}
                                        <td className="px-2 py-1.5 align-top text-right">
                                            <Input
                                                inputMode="decimal"
                                                placeholder={savedCostIncl ?? "—"}
                                                value={e.costIncl}
                                                onChange={(ev) => onCostInclChange(item, ev.target.value)}
                                                className="h-8 w-20 text-right text-sm font-mono"
                                            />
                                            {savedCostIncl && (
                                                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                                                    {savedCostIncl}
                                                </div>
                                            )}
                                        </td>

                                        {/* mrp */}
                                        <td className="px-2 py-1.5 align-top text-right">
                                            <Input
                                                inputMode="decimal"
                                                placeholder={savedMrpIncl ?? "—"}
                                                value={e.mrpIncl}
                                                onChange={(ev) => onMrpInclChange(item, ev.target.value)}
                                                className="h-8 w-20 text-right text-sm font-mono"
                                            />
                                            {savedMrpIncl && (
                                                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                                                    {savedMrpIncl}
                                                </div>
                                            )}
                                        </td>

                                        {/* actions */}
                                        <td className="px-1 py-1.5 align-top whitespace-nowrap text-right">
                                            {dirty && (
                                                <Button
                                                    size="icon-sm"
                                                    aria-label="Save"
                                                    onClick={() => saveRow(item)}
                                                    disabled={savingId === item.id}
                                                >
                                                    <Save className="size-4" />
                                                </Button>
                                            )}
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon-sm"
                                                aria-label="Edit product"
                                                title="Edit product"
                                                onClick={() => openEdit(item.id)}
                                                className="ml-1"
                                            >
                                                <Pencil className="size-4" />
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <ScrollBar orientation="horizontal" />
                    <ScrollBar orientation="vertical" />
                </TableScrollArea>
            ) : (
                <TableScrollArea>
                    {/* sticky top column header — shared by every group */}
                    <div className={`${ROW_GRID} sticky top-0 z-10 bg-muted/40 backdrop-blur-sm px-2 py-2 border-b border-border text-[10px] font-medium uppercase tracking-wide text-muted-foreground`}>
                        <div>Product</div>
                        <div className="text-right" title="Tally-style opening unit cost (excl-GST). Lands on InvProduct.openingRate.">Opening excl</div>
                        <div className="text-right" title="Opening rate including GST — derived from excl × (1 + GST%).">Opening incl</div>
                        <div className="text-right">MRP</div>
                        <div className="text-right">{/* actions */}</div>
                    </div>
                    <div className="divide-y divide-border">
                        {grouped.map(([key, groupItems]) => {
                            const isOpen = expanded.has(key);
                            const noCost = groupItems.filter((i) => i.resolvedCostPaise == null).length;
                            const noMrp = groupItems.filter((i) => !i.mrpPaise || i.mrpPaise <= 0).length;

                            return (
                                <div key={key}>
                                    {/* group header */}
                                    <button
                                        className="w-full flex items-center gap-2 px-2 py-2 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
                                        onClick={() => toggleGroup(key)}
                                    >
                                        {isOpen
                                            ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                                            : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                                        }
                                        <span className="font-medium text-sm">{key}</span>
                                        <span className="text-xs text-muted-foreground ml-1">
                                            {groupItems.length} item{groupItems.length !== 1 ? "s" : ""}
                                        </span>
                                        <span className="ml-auto flex items-center gap-1.5">
                                            {noCost > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{noCost} no cost</Badge>}
                                            {noMrp > 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-700 border-amber-400">{noMrp} no MRP</Badge>}
                                        </span>
                                    </button>

                                    {/* product rows */}
                                    {isOpen && (
                                        <div className="divide-y divide-border">
                                            {groupItems.map((item) => {
                                                const att = attention(item);
                                                const e = editFor(item);
                                                const dirty = isDirty(item);
                                                const gst = item.gstRatePct;
                                                const savedCostExcl = item.resolvedCostPaise != null ? fmt(item.resolvedCostPaise) : null;
                                                const savedCostIncl = item.resolvedCostPaise != null ? fmt(item.resolvedCostPaise, gst) : null;
                                                const savedMrpIncl = item.mrpPaise != null && item.mrpPaise > 0 ? fmt(item.mrpPaise) : null;

                                                return (
                                                    <div
                                                        key={item.id}
                                                        className={`${ROW_GRID} px-2 py-1.5 ${att.includes("cost") ? "bg-red-50/40" : ""}`}
                                                    >
                                                        {/* product */}
                                                        <div className="min-w-0">
                                                            <div className="text-sm font-medium leading-tight">{item.name}</div>
                                                            <div className="text-xs text-muted-foreground mt-0.5 font-mono">{item.sku}</div>
                                                            <div className="flex flex-wrap items-center gap-1 mt-1">
                                                                {item.brandName && (
                                                                    <span className="text-[10px] text-muted-foreground">{item.brandName}</span>
                                                                )}
                                                                {gst > 0 && (
                                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-normal">
                                                                        GST {gst}%
                                                                    </Badge>
                                                                )}
                                                                {att.includes("cost") && (
                                                                    <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">no cost</Badge>
                                                                )}
                                                                {att.includes("mrp") && (
                                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-amber-700 border-amber-400 bg-amber-50">
                                                                        no MRP
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* cost excl */}
                                                        <div>
                                                            <Input
                                                                inputMode="decimal"
                                                                placeholder={savedCostExcl ?? "—"}
                                                                value={e.costExcl}
                                                                onChange={(ev) => onCostExclChange(item, ev.target.value)}
                                                                className="h-8 w-full text-right text-sm font-mono"
                                                            />
                                                            {savedCostExcl && (
                                                                <div className="text-[10px] text-muted-foreground text-right mt-0.5 truncate">
                                                                    {savedCostExcl}
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* cost incl */}
                                                        <div>
                                                            <Input
                                                                inputMode="decimal"
                                                                placeholder={savedCostIncl ?? "—"}
                                                                value={e.costIncl}
                                                                onChange={(ev) => onCostInclChange(item, ev.target.value)}
                                                                className="h-8 w-full text-right text-sm font-mono"
                                                            />
                                                            {savedCostIncl && (
                                                                <div className="text-[10px] text-muted-foreground text-right mt-0.5 truncate">
                                                                    {savedCostIncl}
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* mrp */}
                                                        <div>
                                                            <Input
                                                                inputMode="decimal"
                                                                placeholder={savedMrpIncl ?? "—"}
                                                                value={e.mrpIncl}
                                                                onChange={(ev) => onMrpInclChange(item, ev.target.value)}
                                                                className="h-8 w-full text-right text-sm font-mono"
                                                            />
                                                            {savedMrpIncl && (
                                                                <div className="text-[10px] text-muted-foreground text-right mt-0.5 truncate">
                                                                    {savedMrpIncl}
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* actions */}
                                                        <div className="flex items-center justify-end gap-1">
                                                            {dirty && (
                                                                <Button
                                                                    size="icon-sm"
                                                                    aria-label="Save"
                                                                    onClick={() => saveRow(item)}
                                                                    disabled={savingId === item.id}
                                                                >
                                                                    <Save className="size-4" />
                                                                </Button>
                                                            )}
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="icon-sm"
                                                                aria-label="Edit product"
                                                                title="Edit product"
                                                                onClick={() => openEdit(item.id)}
                                                            >
                                                                <Pencil className="size-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </TableScrollArea>
            )}

            {/* legend — hidden in item-wise view so the full-bleed table can extend */}
            {!loading && filtered.length > 0 && view !== "item" && (
                <p className="flex-none text-xs text-muted-foreground">
                    <strong>Opening rate</strong> — enter excl or incl; the other auto-fills. Saves to <code>InvProduct.openingRate</code> (Tally-style opening) and mirrors into the cost cache so the resolver picks it up.{" "}
                    <strong>MRP</strong> — sticker price (incl GST per Indian law).{" "}
                    <strong>Pencil</strong> — open the full product edit form.
                </p>
            )}

            <InvProductDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                editId={editProductId}
                onSaved={load}
            />
        </div>
    );
}
