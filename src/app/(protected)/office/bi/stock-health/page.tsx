"use client";

// Stock Health — the HOUSE movement lens (recency classes with per-group /
// per-category bands), shared with the Reorder page via movementClass.ts.
// BI → FSN stays the textbook turnover lens; this page explains what the
// classifier decided per item and WHY (band + source), plus the money locked.

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { fmt } from "@/utils/constants";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty, fmtDate } from "@/modules/bi/lib/format";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type MovementClass = "NEW" | "REGULAR" | "SLOW" | "NON_MOVING" | "DEAD";

interface Row {
    id: number; sku: string; name: string;
    unit: string | null; group: string | null; brand: string | null; category: string | null;
    inHouse: boolean;
    movementClass: MovementClass;
    blip: boolean;
    lastSaleDate: string | null;
    daysSinceLastSale: number | null;
    activeDays: number;
    clearanceDays: number;
    avgDailyUsage: number;
    usageWindowDays: number;
    bands: { slowAfterDays: number; nonMovingAfterDays: number; deadAfterDays: number; source: string };
    stock: number;
    stockValue: number;
    action: string;
}

interface Report {
    method: string;
    branches: { id: string; name: string }[];
    summary: { movementClass: MovementClass; items: number; stockValue: number }[];
    rows: Row[];
}

const CLASS_LABELS: Record<MovementClass, string> = {
    DEAD: "Dead", NON_MOVING: "Non-moving", SLOW: "Slow", NEW: "New", REGULAR: "Regular",
};
const CLASS_BADGES: Record<MovementClass, string> = {
    DEAD: "bg-red-500/15 text-red-600",
    NON_MOVING: "bg-orange-500/15 text-orange-600",
    SLOW: "bg-amber-500/15 text-amber-600",
    NEW: "bg-blue-500/15 text-blue-600",
    REGULAR: "bg-emerald-500/15 text-emerald-600",
};
const ALL_BRANCHES = "__all__";

export default function StockHealthPage() {
    const [branchId, setBranchId] = useState("");
    const [classFilter, setClassFilter] = useState<MovementClass | "ALL">("ALL");
    const [search, setSearch] = useState("");

    const { data, loading } = useBiQuery<Report>(
        `/api/bi/stock-health${branchId ? `?branchId=${branchId}` : ""}`,
    );

    const rows = useMemo(() => {
        if (!data) return [];
        const q = search.trim().toLowerCase();
        return data.rows.filter((r) =>
            (classFilter === "ALL" || r.movementClass === classFilter) &&
            (!q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)),
        );
    }, [data, classFilter, search]);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Stock Health</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        House lens: recency-based movement classes (drives the{" "}
                        <Link href="/office/inventory/reorder" className="underline hover:text-foreground">Reorder page</Link>).
                        Bands resolve group → category → org defaults. For the textbook turnover lens, see{" "}
                        <Link href="/office/bi/fsn" className="underline hover:text-foreground">FSN &amp; Dead Stock</Link>.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        className="h-9 w-52"
                        placeholder="Search item / SKU…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <Select value={branchId || ALL_BRANCHES} onValueChange={(v) => setBranchId(v === ALL_BRANCHES ? "" : v)}>
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
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {data.summary.map((s) => (
                            <button
                                key={s.movementClass}
                                onClick={() => setClassFilter(classFilter === s.movementClass ? "ALL" : s.movementClass)}
                                className={`rounded-lg border p-3 text-left shadow-sm transition-colors ${
                                    classFilter === s.movementClass ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/40"
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CLASS_BADGES[s.movementClass]}`}>
                                        {CLASS_LABELS[s.movementClass]}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{s.items} items</span>
                                </div>
                                <div className="mt-1 text-lg font-mono font-semibold text-foreground">{fmt(s.stockValue)}</div>
                                <div className="text-[11px] text-muted-foreground">
                                    {s.movementClass === "DEAD" || s.movementClass === "NON_MOVING" ? "value locked" : "stock value"}
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Item</th>
                                    <th className="px-3 py-2 text-left font-medium">Class</th>
                                    <th className="px-3 py-2 text-right font-medium">Last sale</th>
                                    <th className="px-3 py-2 text-right font-medium">Days ago</th>
                                    <th className="px-3 py-2 text-right font-medium">Active days</th>
                                    <th className="px-3 py-2 text-right font-medium">Avg / day</th>
                                    <th className="px-3 py-2 text-left font-medium">Band (S/N/D · source)</th>
                                    <th className="px-3 py-2 text-right font-medium">Stock</th>
                                    <th className="px-3 py-2 text-right font-medium">Value</th>
                                    <th className="px-3 py-2 text-left font-medium">Reorder action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 ? (
                                    <tr><td colSpan={10} className="py-12 text-center text-muted-foreground text-sm">Nothing to show.</td></tr>
                                ) : rows.map((r) => (
                                    <tr key={r.id} className={`border-b last:border-0 hover:bg-muted/40 ${r.movementClass === "DEAD" ? "bg-red-500/5" : r.movementClass === "NON_MOVING" ? "bg-orange-500/5" : ""}`}>
                                        <td className="px-3 py-2">
                                            <span className="font-medium text-foreground">{r.name}</span>
                                            <span className="ml-2 font-mono text-xs text-muted-foreground">{r.sku}</span>
                                            {r.inHouse && <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-500/15 text-sky-600">In-house</span>}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CLASS_BADGES[r.movementClass]}`}>
                                                {CLASS_LABELS[r.movementClass]}{r.blip ? " · blip" : ""}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right text-xs text-muted-foreground">{fmtDate(r.lastSaleDate)}</td>
                                        <td className="px-3 py-2 text-right font-mono">{r.daysSinceLastSale ?? "—"}</td>
                                        <td className="px-3 py-2 text-right font-mono" title={r.clearanceDays > 0 ? `${r.clearanceDays} clearance day(s) in the window — excluded from demand and the revival ladder` : undefined}>
                                            {r.activeDays || "—"}
                                            {r.clearanceDays > 0 && (
                                                <span className="ml-1 rounded px-1 py-0.5 text-[10px] font-medium bg-purple-500/15 text-purple-600">clr {r.clearanceDays}</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">{r.avgDailyUsage > 0 ? r.avgDailyUsage.toFixed(2) : "—"}</td>
                                        <td className="px-3 py-2 text-xs text-muted-foreground">
                                            <span className="font-mono">{r.bands.slowAfterDays}/{r.bands.nonMovingAfterDays}/{r.bands.deadAfterDays}</span>
                                            <span className="ml-1.5">({r.bands.source})</span>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">{fmtQty(r.stock)}{r.unit ? ` ${r.unit}` : ""}</td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(r.stockValue)}</td>
                                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.action}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
        </ScrollArea>
    );
}
