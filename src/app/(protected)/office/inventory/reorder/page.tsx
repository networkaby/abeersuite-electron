"use client";

// Reorder Status — Tally's "Reorder Levels" screen done with the complete
// formula (sampling window and coverage horizon kept separate):
//
//   reorder level = avg daily usage (30-day window) × lead time (days)
//   threshold     = max(reorder level, manual floor)
//   LOW           = available (stock − reserved) <= threshold
//
// Two tabs:
//   • Item wise — one row per product; lead time + floor edited inline
//     (PATCH /api/inventory/products/:id).
//   • Smart — substitute bands: items in the same leaf product group whose
//     last-inward COST sits within x% pool their demand (Enter UPS ≈ Frontech
//     UPS), so the shop orders the band once, not every brand. Member rows
//     show cost + margin% — cost decides the band, margin decides which brand
//     to procure.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { extractApiError } from "@/shared/lib/api";
import { fmt } from "@/utils/constants";

interface ReorderRow {
    id: number;
    sku: string;
    name: string;
    /** BOM output — made in-house; hidden from Smart bands, badged here. */
    inHouse: boolean;
    unit: string | null;
    group: string | null;
    groupId: number | null;
    brand: string | null;
    category: string | null;
    stock: number;
    reserved: number;
    available: number;
    avgDailyUsage: number;
    leadTimeDays: number;
    ownLeadTimeDays: number | null;
    reorderLevel: number;
    lowStockThreshold: number;
    threshold: number;
    isLow: boolean;
    shortfall: number;
    costPaise: number | null;
    marginPct: number | null;
}

interface Band {
    key: string;
    groupName: string | null;
    costMinPaise: number | null;
    costMaxPaise: number | null;
    productIds: number[];
    available: number;
    avgDailyUsage: number;
    leadTimeDays: number;
    reorderLevel: number;
    threshold: number;
    isLow: boolean;
    shortfall: number;
}

interface Report {
    windowDays: number;
    defaultLeadTimeDays: number;
    tolerancePct: number;
    branches: { id: string; name: string }[];
    lowCount: number;
    rows: ReorderRow[];
    bands: Band[] | null;
}

const ALL_BRANCHES = "__all__";

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtCost = (paise: number | null) => (paise == null ? "—" : fmt(paise / 100));

export default function ReorderPage() {
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [branchId, setBranchId] = useState("");
    const [lowOnly, setLowOnly] = useState(false);
    const [search, setSearch] = useState("");
    const [tab, setTab] = useState<"items" | "smart">("items");
    const [tolerance, setTolerance] = useState(20);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (branchId) params.set("branchId", branchId);
            if (tab === "smart") { params.set("grouped", "1"); params.set("tolerance", String(tolerance)); }
            const qs = params.toString();
            const res = await axios.get<Report>(`/api/inventory/reports/reorder${qs ? `?${qs}` : ""}`);
            setData(res.data);
        } catch (err) {
            toast.error(extractApiError(err, "Failed to load reorder report"));
        } finally {
            setLoading(false);
        }
    }, [branchId, tab, tolerance]);

    useEffect(() => { void load(); }, [load]);

    // Inline edit of leadTimeDays / lowStockThreshold — PATCH then reload so
    // the computed level/threshold columns stay server-authoritative.
    async function saveField(id: number, field: "leadTimeDays" | "lowStockThreshold", raw: string) {
        const trimmed = raw.trim();
        // Lead time: blank = clear override (back to org default). Floor: blank = ignore.
        const value = trimmed === ""
            ? (field === "leadTimeDays" ? null : undefined)
            : Math.max(0, parseInt(trimmed, 10) || 0);
        if (value === undefined) return;
        const current = data?.rows.find((r) => r.id === id);
        if (current && (field === "leadTimeDays" ? current.ownLeadTimeDays : current.lowStockThreshold) === value) return;
        try {
            await axios.patch(`/api/inventory/products/${id}`, { [field]: value });
            toast.success("Saved");
            await load();
        } catch (err) {
            toast.error(extractApiError(err, "Failed to save"));
        }
    }

    const rowById = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);

    const q = search.trim().toLowerCase();
    const matchesSearch = useCallback(
        (r: ReorderRow) => !q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q),
        [q],
    );

    const itemRows = useMemo(
        () => (data?.rows ?? []).filter((r) => (!lowOnly || r.isLow) && matchesSearch(r)),
        [data, lowOnly, matchesSearch],
    );

    const bandRows = useMemo(
        () => (data?.bands ?? []).filter((b) =>
            (!lowOnly || b.isLow) &&
            (!q || b.productIds.some((id) => { const r = rowById.get(id); return r ? matchesSearch(r) : false; })),
        ),
        [data, lowOnly, q, rowById, matchesSearch],
    );

    const toggleExpand = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });

    const bandLabel = (b: Band): string => {
        if (b.productIds.length === 1) return rowById.get(b.productIds[0])?.name ?? "—";
        const range = b.costMinPaise === b.costMaxPaise
            ? fmtCost(b.costMinPaise)
            : `${fmtCost(b.costMinPaise)}–${fmtCost(b.costMaxPaise)}`;
        return `${b.groupName ?? "Ungrouped"} · cost ${range}`;
    };

    const lowCount = tab === "smart"
        ? (data?.bands ?? []).filter((b) => b.isLow).length
        : data?.lowCount ?? 0;

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Reorder Status</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Level = avg daily usage (last {data?.windowDays ?? 30} days) × lead time, floored by the manual
                        minimum. LOW when available (stock − reserved) is at or under the level.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        className="h-9 w-52"
                        placeholder="Search item / SKU…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <Select
                        value={branchId || ALL_BRANCHES}
                        onValueChange={(v) => setBranchId(v === ALL_BRANCHES ? "" : v)}
                    >
                        <SelectTrigger className="h-9 w-44">
                            <SelectValue placeholder="All branches" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                            {(data?.branches ?? []).map((b) => (
                                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" className="h-9" onClick={() => void load()}>
                        <RefreshCw className="size-4" />
                    </Button>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
                <Tabs value={tab} onValueChange={(v) => setTab(v as "items" | "smart")}>
                    <TabsList>
                        <TabsTrigger value="items">Item wise</TabsTrigger>
                        <TabsTrigger value="smart">Smart (substitute bands)</TabsTrigger>
                    </TabsList>
                </Tabs>
                {tab === "smart" && (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Cost tolerance ±%</span>
                        <Input
                            className="h-8 w-16 text-right font-mono text-xs"
                            inputMode="numeric"
                            defaultValue={tolerance}
                            key={`tol-${tolerance}`}
                            onBlur={(e) => {
                                const v = Math.min(Math.max(parseInt(e.target.value, 10) || 20, 1), 100);
                                if (v !== tolerance) setTolerance(v);
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        />
                        <span className="text-[11px] text-muted-foreground">
                            same group + cost within x% = substitutes, demand pooled
                        </span>
                    </div>
                )}
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setLowOnly((v) => !v)}
                            className={`rounded-lg border p-3 text-left shadow-sm transition-colors ${
                                lowOnly ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/40"
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <TriangleAlert className="size-4 text-destructive" />
                                <span className="text-lg font-mono font-semibold text-foreground">{lowCount}</span>
                                <span className="text-xs text-muted-foreground">
                                    {tab === "smart" ? "bands at / below reorder level" : "items at / below reorder level"}
                                </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                                {lowOnly ? "showing low only — click to show all" : "click to show low only"}
                            </div>
                        </button>
                        <p className="text-xs text-muted-foreground">
                            Default lead time: <span className="font-mono">{data.defaultLeadTimeDays}d</span> (Settings →
                            Org defaults). A blank Lead-time cell rides the default; type a value to override per item.
                        </p>
                    </div>

                    {tab === "items" ? (
                    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Item</th>
                                    <th className="px-3 py-2 text-right font-medium">Stock</th>
                                    <th className="px-3 py-2 text-right font-medium">Reserved</th>
                                    <th className="px-3 py-2 text-right font-medium">Available</th>
                                    <th className="px-3 py-2 text-right font-medium">Avg use / day</th>
                                    <th className="px-3 py-2 text-right font-medium">Lead time (d)</th>
                                    <th className="px-3 py-2 text-right font-medium">Reorder level</th>
                                    <th className="px-3 py-2 text-right font-medium">Min floor</th>
                                    <th className="px-3 py-2 text-right font-medium">Shortfall</th>
                                    <th className="px-3 py-2 text-center font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {itemRows.length === 0 ? (
                                    <tr><td colSpan={10} className="py-12 text-center text-muted-foreground text-sm">
                                        {lowOnly ? "Nothing at or below its reorder level. 🎉" : "No active products."}
                                    </td></tr>
                                ) : itemRows.map((r) => (
                                    <tr key={r.id} className={`border-b last:border-0 hover:bg-muted/40 ${r.isLow ? "bg-amber-500/5" : ""}`}>
                                        <td className="px-3 py-2">
                                            <span className="font-medium text-foreground">{r.name}</span>
                                            <span className="ml-2 font-mono text-xs text-muted-foreground">{r.sku}</span>
                                            {r.inHouse && (
                                                <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-500/15 text-sky-600" title="BOM output — produced in-house. LOW here means: go pack/assemble, not purchase.">
                                                    In-house
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">{fmtQty(r.stock)}{r.unit ? ` ${r.unit}` : ""}</td>
                                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{r.reserved > 0 ? fmtQty(r.reserved) : "—"}</td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold">{fmtQty(r.available)}</td>
                                        <td className="px-3 py-2 text-right font-mono">{r.avgDailyUsage > 0 ? r.avgDailyUsage.toFixed(2) : "—"}</td>
                                        <td className="px-3 py-2 text-right">
                                            <Input
                                                key={`lt-${r.id}-${r.ownLeadTimeDays ?? ""}`}
                                                className="h-7 w-16 ml-auto text-right font-mono text-xs"
                                                inputMode="numeric"
                                                placeholder={String(r.leadTimeDays)}
                                                defaultValue={r.ownLeadTimeDays ?? ""}
                                                onBlur={(e) => void saveField(r.id, "leadTimeDays", e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">{fmtQty(r.reorderLevel)}</td>
                                        <td className="px-3 py-2 text-right">
                                            <Input
                                                key={`fl-${r.id}-${r.lowStockThreshold}`}
                                                className="h-7 w-16 ml-auto text-right font-mono text-xs"
                                                inputMode="numeric"
                                                defaultValue={r.lowStockThreshold}
                                                onBlur={(e) => void saveField(r.id, "lowStockThreshold", e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-destructive">
                                            {r.shortfall > 0 ? fmtQty(r.shortfall) : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {r.isLow ? (
                                                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-600">LOW</span>
                                            ) : (
                                                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-600">OK</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    ) : (
                    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Band (group · cost range)</th>
                                    <th className="px-3 py-2 text-right font-medium">Items</th>
                                    <th className="px-3 py-2 text-right font-medium">Available</th>
                                    <th className="px-3 py-2 text-right font-medium">Avg use / day</th>
                                    <th className="px-3 py-2 text-right font-medium">Lead (d)</th>
                                    <th className="px-3 py-2 text-right font-medium">Reorder level</th>
                                    <th className="px-3 py-2 text-right font-medium">Shortfall</th>
                                    <th className="px-3 py-2 text-center font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bandRows.length === 0 ? (
                                    <tr><td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">
                                        {lowOnly ? "No band at or below its reorder level. 🎉" : "No active products."}
                                    </td></tr>
                                ) : bandRows.map((b) => {
                                    const multi = b.productIds.length > 1;
                                    const isOpen = expanded.has(b.key);
                                    return (
                                    <Fragment key={b.key}>
                                    <tr
                                        className={`border-b last:border-0 hover:bg-muted/40 ${b.isLow ? "bg-amber-500/5" : ""} ${multi ? "cursor-pointer" : ""}`}
                                        onClick={multi ? () => toggleExpand(b.key) : undefined}
                                    >
                                        <td className="px-3 py-2">
                                            <span className="inline-flex items-center gap-1.5">
                                                {multi ? (
                                                    isOpen ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />
                                                ) : <span className="inline-block w-3.5" />}
                                                <span className="font-medium text-foreground">{bandLabel(b)}</span>
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">{b.productIds.length}</td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold">{fmtQty(b.available)}</td>
                                        <td className="px-3 py-2 text-right font-mono">{b.avgDailyUsage > 0 ? b.avgDailyUsage.toFixed(2) : "—"}</td>
                                        <td className="px-3 py-2 text-right font-mono">{b.leadTimeDays}</td>
                                        <td className="px-3 py-2 text-right font-mono">{fmtQty(b.threshold)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-destructive">{b.shortfall > 0 ? fmtQty(b.shortfall) : "—"}</td>
                                        <td className="px-3 py-2 text-center">
                                            {b.isLow ? (
                                                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-600">LOW</span>
                                            ) : (
                                                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-600">OK</span>
                                            )}
                                        </td>
                                    </tr>
                                    {multi && isOpen && b.productIds.map((id) => {
                                        const r = rowById.get(id);
                                        if (!r) return null;
                                        return (
                                        <tr key={`${b.key}-${id}`} className="border-b last:border-0 bg-muted/20 text-xs">
                                            <td className="px-3 py-1.5 pl-9">
                                                <span className="text-foreground">{r.name}</span>
                                                <span className="ml-2 font-mono text-muted-foreground">{r.sku}</span>
                                                {r.brand && <span className="ml-2 text-muted-foreground">{r.brand}</span>}
                                            </td>
                                            <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                                cost {fmtCost(r.costPaise)}
                                            </td>
                                            <td className="px-3 py-1.5 text-right font-mono">{fmtQty(r.available)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono">{r.avgDailyUsage > 0 ? r.avgDailyUsage.toFixed(2) : "—"}</td>
                                            <td className="px-3 py-1.5 text-right font-mono">{r.leadTimeDays}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-muted-foreground" colSpan={2}>
                                                margin {r.marginPct != null ? `${r.marginPct.toFixed(1)}%` : "—"}
                                            </td>
                                            <td className="px-3 py-1.5 text-center">
                                                {r.available <= 0 && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-600">ZERO</span>}
                                            </td>
                                        </tr>
                                        );
                                    })}
                                    </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    )}
                </>
            )}
        </div>
        </ScrollArea>
    );
}
