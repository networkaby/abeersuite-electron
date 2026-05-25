"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import {
    AlertCircle, AlertTriangle, ChevronDown, ChevronRight,
    Pencil, RefreshCw, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { PricingItem } from "@/app/api/pricing-strategy/items/route";

// ── helpers ────────────────────────────────────────────────────────────────────

type View = "group" | "category" | "brand";

function groupKey(item: PricingItem, view: View): string {
    if (view === "category") return item.categoryName ?? "— No category —";
    if (view === "brand")    return item.brandName    ?? "— No brand —";
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
    if (item.resolvedCostPaise == null)               out.push("cost");
    if (item.mrpPaise == null || item.mrpPaise <= 0)  out.push("mrp");
    return out;
}

// ── types ──────────────────────────────────────────────────────────────────────

type RowEdit = {
    /** Cost – stored as excl paise; both fields kept in sync. */
    costExcl: string;
    costIncl: string;
    /** MRP – stored as incl paise; both fields kept in sync. */
    mrpExcl:  string;
    mrpIncl:  string;
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
    let mrpExcl = "";
    let mrpIncl = "";
    if (item.mrpPaise != null && item.mrpPaise > 0) {
        mrpIncl = (item.mrpPaise / 100).toFixed(2);
        mrpExcl = inclToExcl(mrpIncl, gst);
    }

    return { costExcl, costIncl, mrpExcl, mrpIncl };
}

// ── component ─────────────────────────────────────────────────────────────────

export default function NeedsAttentionPage() {
    const [items,   setItems]   = useState<PricingItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [view,    setView]    = useState<View>("group");
    const [showCost, setShowCost] = useState(true);
    const [showMrp,  setShowMrp]  = useState(true);

    const [edits,    setEdits]    = useState<Record<number, RowEdit>>({});
    const [savingId, setSavingId] = useState<number | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const mrpCount  = useMemo(() => items.filter((i) => !i.mrpPaise || i.mrpPaise <= 0).length, [items]);

    // ── filtered + grouped ────────────────────────────────────────────────────

    const filtered = useMemo(() => items.filter((i) => {
        const att = attention(i);
        if (showCost && att.includes("cost")) return true;
        if (showMrp  && att.includes("mrp"))  return true;
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

    // ── edit helpers ──────────────────────────────────────────────────────────

    const editFor = (item: PricingItem): RowEdit => edits[item.id] ?? emptyEdit(item);

    const setEdit = (item: PricingItem, patch: Partial<RowEdit>) =>
        setEdits((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] ?? emptyEdit(item)), ...patch } }));

    const onCostExclChange = (item: PricingItem, val: string) =>
        setEdit(item, { costExcl: val, costIncl: exclToIncl(val, item.gstRatePct) });

    const onCostInclChange = (item: PricingItem, val: string) =>
        setEdit(item, { costIncl: val, costExcl: inclToExcl(val, item.gstRatePct) });

    const onMrpExclChange = (item: PricingItem, val: string) =>
        setEdit(item, { mrpExcl: val, mrpIncl: exclToIncl(val, item.gstRatePct) });

    const onMrpInclChange = (item: PricingItem, val: string) =>
        setEdit(item, { mrpIncl: val, mrpExcl: inclToExcl(val, item.gstRatePct) });

    function isDirty(item: PricingItem): boolean {
        const e    = editFor(item);
        const base = emptyEdit(item);
        return e.costExcl !== base.costExcl || e.mrpIncl !== base.mrpIncl;
    }

    // ── save row ──────────────────────────────────────────────────────────────

    const saveRow = async (item: PricingItem) => {
        const e    = editFor(item);
        const base = emptyEdit(item);
        const payload: Record<string, unknown> = {};

        if (e.costExcl !== base.costExcl && e.costExcl.trim() !== "") {
            const v = parseFloat(e.costExcl);
            if (!isFinite(v) || v < 0) return toast.error("Invalid cost");
            payload.costPaise = Math.round(v * 100);
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
        <div className="space-y-4">

            {/* header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
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
            <div className="flex flex-wrap items-center gap-2 border border-border bg-muted/30 p-2">
                <span className="text-xs text-muted-foreground font-medium mr-1">Group by:</span>
                {(["group", "category", "brand"] as View[]).map((v) => (
                    <button
                        key={v}
                        onClick={() => setView(v)}
                        className={`text-xs px-2.5 py-1 border rounded transition-colors ${
                            view === v
                                ? "bg-foreground text-background border-foreground"
                                : "border-border hover:bg-muted"
                        }`}
                    >
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                ))}

                <span className="border-l border-border h-5 mx-1" />

                <span className="text-xs text-muted-foreground font-medium mr-1">Show:</span>
                <button
                    onClick={() => setShowCost((p) => !p)}
                    className={`text-xs px-2.5 py-1 border rounded transition-colors ${
                        showCost
                            ? "bg-red-100 border-red-400 text-red-800"
                            : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                >
                    <AlertCircle className="size-3 inline mr-1" />
                    No cost ({costCount})
                </button>
                <button
                    onClick={() => setShowMrp((p) => !p)}
                    className={`text-xs px-2.5 py-1 border rounded transition-colors ${
                        showMrp
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
            ) : (
                <div className="space-y-2">
                    {grouped.map(([key, groupItems]) => {
                        const isOpen  = expanded.has(key);
                        const noCost  = groupItems.filter((i) => i.resolvedCostPaise == null).length;
                        const noMrp   = groupItems.filter((i) => !i.mrpPaise || i.mrpPaise <= 0).length;

                        return (
                            <div key={key} className="border border-border">
                                {/* group header */}
                                <button
                                    className="w-full flex items-center gap-3 px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
                                    onClick={() => toggleGroup(key)}
                                >
                                    {isOpen
                                        ? <ChevronDown  className="size-4 shrink-0 text-muted-foreground" />
                                        : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                                    }
                                    <span className="font-medium text-sm">{key}</span>
                                    <span className="text-xs text-muted-foreground ml-1">
                                        {groupItems.length} item{groupItems.length !== 1 ? "s" : ""}
                                    </span>
                                    <span className="ml-auto flex items-center gap-1.5">
                                        {noCost > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{noCost} no cost</Badge>}
                                        {noMrp  > 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-700 border-amber-400">{noMrp} no MRP</Badge>}
                                    </span>
                                </button>

                                {/* product rows */}
                                {isOpen && (
                                    <div className="divide-y divide-border">
                                        {groupItems.map((item) => {
                                            const att   = attention(item);
                                            const e     = editFor(item);
                                            const dirty = isDirty(item);
                                            const gst   = item.gstRatePct;

                                            return (
                                                <div
                                                    key={item.id}
                                                    className={`px-3 py-2.5 flex flex-wrap items-start gap-3 ${att.includes("cost") ? "bg-red-50/30" : ""}`}
                                                >
                                                    {/* product info */}
                                                    <div className="flex-1 min-w-[180px]">
                                                        <div className="text-sm font-medium leading-tight">{item.name}</div>
                                                        <div className="text-xs text-muted-foreground mt-0.5">
                                                            {item.sku}
                                                            {item.brandName ? ` · ${item.brandName}` : ""}
                                                        </div>
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {att.includes("cost") && (
                                                                <span className="text-[10px] font-medium text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                                                                    no cost
                                                                </span>
                                                            )}
                                                            {att.includes("mrp") && (
                                                                <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                                                                    no MRP
                                                                </span>
                                                            )}
                                                            {gst > 0 && (
                                                                <span className="text-[10px] text-muted-foreground">
                                                                    GST {gst}%
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* cost inputs: excl ↔ incl */}
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                                                            Cost{gst > 0 ? ` (GST ${gst}%)` : ""}
                                                        </span>
                                                        <div className="flex items-end gap-1">
                                                            <div className="flex flex-col gap-0.5 w-[88px]">
                                                                <span className="text-[10px] text-muted-foreground">Excl</span>
                                                                <Input
                                                                    inputMode="decimal"
                                                                    placeholder="₹ excl"
                                                                    value={e.costExcl}
                                                                    onChange={(ev) => onCostExclChange(item, ev.target.value)}
                                                                    className="h-8 text-right text-sm"
                                                                />
                                                            </div>
                                                            <div className="flex flex-col gap-0.5 w-[88px]">
                                                                <span className="text-[10px] text-muted-foreground">Incl</span>
                                                                <Input
                                                                    inputMode="decimal"
                                                                    placeholder="₹ incl"
                                                                    value={e.costIncl}
                                                                    onChange={(ev) => onCostInclChange(item, ev.target.value)}
                                                                    className="h-8 text-right text-sm"
                                                                />
                                                            </div>
                                                        </div>
                                                        {item.resolvedCostPaise != null && (
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {fmt(item.resolvedCostPaise)} excl / {fmt(item.resolvedCostPaise, gst)} incl saved
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* MRP inputs: excl ↔ incl */}
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                                                            MRP{gst > 0 ? ` (GST ${gst}%)` : ""}
                                                        </span>
                                                        <div className="flex items-end gap-1">
                                                            <div className="flex flex-col gap-0.5 w-[88px]">
                                                                <span className="text-[10px] text-muted-foreground">Excl</span>
                                                                <Input
                                                                    inputMode="decimal"
                                                                    placeholder="₹ excl"
                                                                    value={e.mrpExcl}
                                                                    onChange={(ev) => onMrpExclChange(item, ev.target.value)}
                                                                    className="h-8 text-right text-sm"
                                                                />
                                                            </div>
                                                            <div className="flex flex-col gap-0.5 w-[88px]">
                                                                <span className="text-[10px] text-muted-foreground">Incl</span>
                                                                <Input
                                                                    inputMode="decimal"
                                                                    placeholder="₹ incl"
                                                                    value={e.mrpIncl}
                                                                    onChange={(ev) => onMrpInclChange(item, ev.target.value)}
                                                                    className="h-8 text-right text-sm"
                                                                />
                                                            </div>
                                                        </div>
                                                        {item.mrpPaise != null && item.mrpPaise > 0 && (
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {fmt(item.mrpPaise / (1 + gst / 100))} excl / {fmt(item.mrpPaise)} incl saved
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* actions */}
                                                    <div className="flex items-end gap-1.5 pb-0.5 self-end">
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
                                                        <Link
                                                            href={`/office/inventory/products?edit=${item.id}`}
                                                            title="Edit product"
                                                            aria-label="Edit product"
                                                            className="inline-flex items-center justify-center size-7 border border-border rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                                        >
                                                            <Pencil className="size-4" />
                                                        </Link>
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
            )}

            {/* legend */}
            {!loading && filtered.length > 0 && (
                <p className="text-xs text-muted-foreground">
                    <strong>Cost</strong> — enter excl or incl; the other auto-fills. Stored net of tax.{" "}
                    <strong>MRP</strong> — sticker price (incl GST per Indian law); enter either side.{" "}
                    <strong>Pencil</strong> — open the full product edit form.
                </p>
            )}
        </div>
    );
}
