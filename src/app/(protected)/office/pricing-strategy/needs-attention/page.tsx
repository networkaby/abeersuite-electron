"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    AlertCircle, AlertTriangle, ChevronDown, ChevronRight,
    RefreshCw, Save, Wand2,
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

/** Convert tax-inclusive rupees → tax-exclusive paise (for cost storage). */
function inclRupeesToExclPaise(rupees: string, gstRatePct: number): number | null {
    const v = parseFloat(rupees);
    if (!isFinite(v) || v < 0) return null;
    const excl = gstRatePct > 0 ? v / (1 + gstRatePct / 100) : v;
    return Math.round(excl * 100);
}

/** Convert tax-inclusive rupees → paise (for MRP / price — already inclusive). */
function inclRupeesToPaise(rupees: string): number | null {
    const v = parseFloat(rupees);
    if (!isFinite(v) || v < 0) return null;
    return Math.round(v * 100);
}

/** Display paise as tax-inclusive rupees string. */
function toInclRupees(paise: number | null, gstRatePct: number): string {
    if (paise == null) return "";
    const incl = gstRatePct > 0 ? (paise / 100) * (1 + gstRatePct / 100) : paise / 100;
    return incl.toFixed(2);
}

/** Format paise → ₹ string for display. */
function fmt(paise: number | null, gstRatePct = 0): string {
    if (paise == null) return "—";
    const v = gstRatePct > 0 ? (paise / 100) * (1 + gstRatePct / 100) : paise / 100;
    return `₹${v.toFixed(2)}`;
}

// ── attention ──────────────────────────────────────────────────────────────────

type AttentionType = "cost" | "mrp" | "price";

function attention(item: PricingItem): AttentionType[] {
    const out: AttentionType[] = [];
    if (item.resolvedCostPaise == null)               out.push("cost");
    if (item.mrpPaise == null || item.mrpPaise <= 0)  out.push("mrp");
    if (item.pricePaise == null)                      out.push("price");
    return out;
}

// ── types ──────────────────────────────────────────────────────────────────────

type RowEdit = {
    costRupees:  string; // tax-inclusive
    mrpRupees:   string; // tax-inclusive (MRP is already incl)
    priceRupees: string; // tax-inclusive
};

function emptyEdit(item: PricingItem): RowEdit {
    return {
        costRupees:  item.lastPurchasePaise != null
            ? toInclRupees(item.lastPurchasePaise, item.gstRatePct)
            : "",
        mrpRupees:   item.mrpPaise != null && item.mrpPaise > 0
            ? (item.mrpPaise / 100).toFixed(2)
            : "",
        priceRupees: item.pricePaise != null
            ? (item.pricePaise / 100).toFixed(2)
            : "",
    };
}

// ── component ─────────────────────────────────────────────────────────────────

export default function NeedsAttentionPage() {
    const [items,   setItems]   = useState<PricingItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [view,    setView]    = useState<View>("group");
    // Which attention types to show (all on by default)
    const [showCost,  setShowCost]  = useState(true);
    const [showMrp,   setShowMrp]   = useState(true);
    const [showPrice, setShowPrice] = useState(true);

    const [edits,     setEdits]     = useState<Record<number, RowEdit>>({});
    const [savingId,  setSavingId]  = useState<number | null>(null);
    const [computing, setComputing] = useState<number | null>(null);
    const [expanded,  setExpanded]  = useState<Set<string>>(new Set());

    const load = () => {
        setLoading(true);
        axios
            .get<PricingItem[]>("/api/pricing-strategy/items?onlyAttention=1")
            .then((r) => {
                setItems(r.data);
                // Auto-expand all groups on first load
                const keys = new Set(r.data.map((i) => groupKey(i, view)));
                setExpanded(keys);
            })
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-expand when view changes so the user doesn't see a collapsed list
    const prevView = useRef(view);
    useEffect(() => {
        if (prevView.current !== view) {
            prevView.current = view;
            const keys = new Set(items.map((i) => groupKey(i, view)));
            setExpanded(keys);
        }
    }, [view, items]);

    // ── counts for filter pills ────────────────────────────────────────────────

    const costCount  = useMemo(() => items.filter((i) => i.resolvedCostPaise == null).length, [items]);
    const mrpCount   = useMemo(() => items.filter((i) => !i.mrpPaise || i.mrpPaise <= 0).length, [items]);
    const priceCount = useMemo(() => items.filter((i) => i.pricePaise == null).length, [items]);

    // ── filtered + grouped ────────────────────────────────────────────────────

    const filtered = useMemo(() => items.filter((i) => {
        const att = attention(i);
        if (showCost  && att.includes("cost"))  return true;
        if (showMrp   && att.includes("mrp"))   return true;
        if (showPrice && att.includes("price")) return true;
        return false;
    }), [items, showCost, showMrp, showPrice]);

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

    const editFor = (item: PricingItem): RowEdit =>
        edits[item.id] ?? emptyEdit(item);

    const setEdit = (item: PricingItem, patch: Partial<RowEdit>) =>
        setEdits((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] ?? emptyEdit(item)), ...patch } }));

    function isDirty(item: PricingItem): boolean {
        const e = editFor(item);
        const base = emptyEdit(item);
        return e.costRupees !== base.costRupees ||
               e.mrpRupees  !== base.mrpRupees  ||
               e.priceRupees !== base.priceRupees;
    }

    // ── save row ──────────────────────────────────────────────────────────────

    const saveRow = async (item: PricingItem) => {
        const e = editFor(item);
        const base = emptyEdit(item);
        const payload: Record<string, unknown> = {};

        if (e.costRupees !== base.costRupees && e.costRupees.trim() !== "") {
            const paise = inclRupeesToExclPaise(e.costRupees, item.gstRatePct);
            if (paise == null) return toast.error("Invalid cost");
            payload.costPaise = paise;
        }
        if (e.mrpRupees !== base.mrpRupees && e.mrpRupees.trim() !== "") {
            const paise = inclRupeesToPaise(e.mrpRupees);
            if (paise == null) return toast.error("Invalid MRP");
            payload.mrpPaise = paise;
        }
        if (e.priceRupees !== base.priceRupees && e.priceRupees.trim() !== "") {
            const paise = inclRupeesToPaise(e.priceRupees);
            if (paise == null) return toast.error("Invalid price");
            const mrp = payload.mrpPaise != null
                ? (payload.mrpPaise as number)
                : (item.mrpPaise ?? null);
            if (mrp != null && mrp > 0 && paise > mrp) {
                return toast.error(`Price ₹${(paise / 100).toFixed(2)} exceeds MRP ₹${(mrp / 100).toFixed(2)}`);
            }
            payload.pricePaise    = paise;
            payload.priceOverridden = true;
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

    // ── compute (run formula) for one product ─────────────────────────────────

    const computeOne = async (item: PricingItem) => {
        if (item.resolvedCostPaise == null) {
            return toast.error("Save a cost first — formula needs a cost basis");
        }
        setComputing(item.id);
        try {
            const r = await axios.post<{ updated: number; skipped: number; errors: { productId: number; reason: string }[] }>(
                "/api/pricing-strategy/apply",
                { productIds: [item.id], forceOverridden: false },
            );
            if (r.data.errors.length) {
                toast.error(r.data.errors[0].reason);
            } else if (r.data.updated === 0) {
                toast.info("Skipped — price is locked. Use the manual Price field.");
            } else {
                toast.success("Price computed and saved");
                load();
            }
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? "Failed" : "Failed");
        } finally {
            setComputing(null);
        }
    };

    // ── toggle group expand ────────────────────────────────────────────────────

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
                {/* view */}
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

                {/* attention filter pills */}
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
                <button
                    onClick={() => setShowPrice((p) => !p)}
                    className={`text-xs px-2.5 py-1 border rounded transition-colors ${
                        showPrice
                            ? "bg-amber-100 border-amber-400 text-amber-800"
                            : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                >
                    <AlertTriangle className="size-3 inline mr-1" />
                    No price ({priceCount})
                </button>
            </div>

            {/* groups */}
            {loading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
            ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                    All products have the required data. ✓
                </p>
            ) : (
                <div className="space-y-2">
                    {grouped.map(([key, groupItems]) => {
                        const isOpen   = expanded.has(key);
                        const noCost   = groupItems.filter((i) => i.resolvedCostPaise == null).length;
                        const noMrp    = groupItems.filter((i) => !i.mrpPaise || i.mrpPaise <= 0).length;
                        const noPrice  = groupItems.filter((i) => i.pricePaise == null).length;

                        return (
                            <div key={key} className="border border-border">
                                {/* group header */}
                                <button
                                    className="w-full flex items-center gap-3 px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
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
                                        {noCost  > 0 && <Badge variant="destructive"  className="text-[10px] px-1.5 py-0">{noCost} no cost</Badge>}
                                        {noMrp   > 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-700 border-amber-400">{noMrp} no MRP</Badge>}
                                        {noPrice > 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-700 border-amber-400">{noPrice} no price</Badge>}
                                    </span>
                                </button>

                                {/* product rows */}
                                {isOpen && (
                                    <div className="divide-y divide-border">
                                        {groupItems.map((item) => {
                                            const att  = attention(item);
                                            const e    = editFor(item);
                                            const dirty = isDirty(item);
                                            const gst  = item.gstRatePct;

                                            return (
                                                <div key={item.id} className={`px-3 py-2.5 flex flex-wrap items-start gap-3 ${att.includes("cost") ? "bg-red-50/30" : ""}`}>

                                                    {/* product info */}
                                                    <div className="flex-1 min-w-[180px]">
                                                        <div className="text-sm font-medium leading-tight">{item.name}</div>
                                                        <div className="text-xs text-muted-foreground mt-0.5">
                                                            {item.sku}
                                                            {item.brandName ? ` · ${item.brandName}` : ""}
                                                        </div>
                                                        {/* attention badges */}
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
                                                            {att.includes("price") && (
                                                                <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                                                                    no price
                                                                </span>
                                                            )}
                                                            {gst > 0 && (
                                                                <span className="text-[10px] text-muted-foreground">
                                                                    GST {gst}%
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* cost input (tax-inclusive) */}
                                                    <div className="flex flex-col gap-0.5 w-[120px]">
                                                        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                                                            Cost{gst > 0 ? " (incl)" : ""}
                                                        </label>
                                                        <Input
                                                            inputMode="decimal"
                                                            placeholder="₹ incl"
                                                            value={e.costRupees}
                                                            onChange={(ev) => setEdit(item, { costRupees: ev.target.value })}
                                                            className="h-8 text-right text-sm"
                                                        />
                                                        {item.resolvedCostPaise != null && (
                                                            <span className="text-[10px] text-muted-foreground text-right">
                                                                {fmt(item.resolvedCostPaise, gst)} resolved
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* MRP input */}
                                                    <div className="flex flex-col gap-0.5 w-[110px]">
                                                        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                                                            MRP (incl)
                                                        </label>
                                                        <Input
                                                            inputMode="decimal"
                                                            placeholder="₹ MRP"
                                                            value={e.mrpRupees}
                                                            onChange={(ev) => setEdit(item, { mrpRupees: ev.target.value })}
                                                            className="h-8 text-right text-sm"
                                                        />
                                                        {item.mrpPaise != null && item.mrpPaise > 0 && (
                                                            <span className="text-[10px] text-muted-foreground text-right">
                                                                {(item.mrpPaise / 100).toFixed(2)} saved
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* price input (manual override) */}
                                                    <div className="flex flex-col gap-0.5 w-[110px]">
                                                        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                                                            Price (incl)
                                                        </label>
                                                        <Input
                                                            inputMode="decimal"
                                                            placeholder="₹ manual"
                                                            value={e.priceRupees}
                                                            onChange={(ev) => setEdit(item, { priceRupees: ev.target.value })}
                                                            className="h-8 text-right text-sm"
                                                        />
                                                        {item.pricePaise != null && (
                                                            <span className="text-[10px] text-muted-foreground text-right">
                                                                {(item.pricePaise / 100).toFixed(2)} saved
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* actions */}
                                                    <div className="flex items-end gap-1.5 pb-0.5">
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
                                                            size="icon-sm"
                                                            variant="outline"
                                                            aria-label="Compute price from formula"
                                                            title={
                                                                item.resolvedCostPaise == null
                                                                    ? "Save a cost first"
                                                                    : `Run formula → ${fmt(item.computedPricePaise, 0)}`
                                                            }
                                                            onClick={() => computeOne(item)}
                                                            disabled={computing === item.id || item.resolvedCostPaise == null}
                                                        >
                                                            <Wand2 className="size-4" />
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
            )}

            {/* legend */}
            {!loading && filtered.length > 0 && (
                <p className="text-xs text-muted-foreground">
                    <strong>Cost (incl)</strong> — enter what you paid including GST; stored net of tax.{" "}
                    <strong>MRP</strong> — printed sticker price (tax-inclusive per Indian law).{" "}
                    <strong>Price</strong> — manual sell price override (tax-inclusive sticker).{" "}
                    <strong>Wand</strong> — runs the matching strategy formula and writes the computed price. Disabled until cost is set.
                </p>
            )}
        </div>
    );
}
