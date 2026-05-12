"use client";

import { useEffect, useMemo, useState, useCallback, Fragment } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import {
    Loader2, ArrowLeft, AlertTriangle, ChevronRight, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmt } from "@/utils/constants";

// ── Types ─────────────────────────────────────────────────────────────────────

type ValuationMethod = "LAST_COST" | "WEIGHTED_AVG" | "FIFO" | "LIFO";

type Row = {
    id:                number;
    sku:               string;
    name:              string;
    stock:             number;
    lowStockThreshold: number;
    costPaise:         number | null;
    pricePaise:        number | null;
    unit:     { code: string; label: string };
    group:    { id: number; name: string } | null;
    brand:    { id: number; name: string } | null;
    category: { id: number; name: string } | null;
    valuation: {
        unitCost: number;
        value:    number;
        method:   ValuationMethod;
        fallback?: "no-receipt-history" | "no-cost-basis" | "not-implemented";
    };
    isLow: boolean;
};

type Response = { method: ValuationMethod; rows: Row[] };
type View = "group" | "category" | "brand";

const METHOD_LABELS: Record<ValuationMethod, string> = {
    LAST_COST:     "Last Cost",
    WEIGHTED_AVG:  "Weighted Avg",
    FIFO:          "FIFO",
    LIFO:          "LIFO",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StockSummaryPage() {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const refSource = params.get("ref");
    const asOf = params.get("asOf");

    // URL-synced state
    const [view, setViewState] = useState<View>(() => {
        const v = params.get("view");
        return v === "category" || v === "brand" ? v : "group";
    });
    const [method, setMethodState] = useState<ValuationMethod>(() => {
        const m = params.get("method");
        return m === "WEIGHTED_AVG" || m === "FIFO" || m === "LIFO" ? m : "LAST_COST";
    });
    const [showProfit, setShowProfitState] = useState<boolean>(() => params.get("profit") === "1");

    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    // ── URL sync helper (don't lose ref/asOf when toggling controls) ──────────
    const pushUrl = useCallback(
        (next: { view?: View; method?: ValuationMethod; showProfit?: boolean }) => {
            const qs = new URLSearchParams(params.toString());
            const v = next.view    ?? view;
            const m = next.method  ?? method;
            const p = next.showProfit ?? showProfit;
            if (v === "group") qs.delete("view"); else qs.set("view", v);
            if (m === "LAST_COST") qs.delete("method"); else qs.set("method", m);
            if (p) qs.set("profit", "1"); else qs.delete("profit");
            router.replace(`${pathname}?${qs.toString()}`);
        },
        [params, pathname, router, view, method, showProfit],
    );

    const setView = (v: View) => { setViewState(v); pushUrl({ view: v }); };
    const setMethod = (m: ValuationMethod) => { setMethodState(m); pushUrl({ method: m }); };
    const setShowProfit = (p: boolean) => { setShowProfitState(p); pushUrl({ showProfit: p }); };

    // ── Fetch (depends on method) ─────────────────────────────────────────────
    useEffect(() => {
        setLoading(true);
        axios
            .get<Response>(`/api/inventory/reports/stock-summary?method=${method}`)
            .then((r) => setRows(r.data.rows))
            .catch(() => toast.error("Failed to load stock summary"))
            .finally(() => setLoading(false));
    }, [method]);

    // ── Group + roll up (client side) ─────────────────────────────────────────
    const grouped = useMemo(() => {
        const keyName = (r: Row): string =>
            view === "group"    ? r.group?.name    ?? "Ungrouped"
          : view === "category" ? r.category?.name ?? "Uncategorised"
          /* brand */            : r.brand?.name    ?? "No brand";

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
                const totalQty   = items.reduce((s, r) => s + (r.stock > 0 ? r.stock : 0), 0);
                const unitCodes = new Set(items.map((r) => r.unit.code));
                const unitCode  = unitCodes.size === 1 ? items[0].unit.code : null;

                // Profit roll-up — only rows where both costPaise and pricePaise are set
                const profitRows = items.filter((r) => r.costPaise != null && r.pricePaise != null && r.stock > 0);
                const totalSaleValue = profitRows.reduce(
                    (s, r) => s + (r.stock * (r.pricePaise ?? 0)) / 100, 0,
                );
                const totalCostValue = profitRows.reduce(
                    (s, r) => s + (r.stock * (r.costPaise ?? 0)) / 100, 0,
                );
                const totalProfit    = totalSaleValue - totalCostValue;
                const margin = totalSaleValue > 0 ? (totalProfit / totalSaleValue) * 100 : null;

                return { name, items, totalValue, totalQty, unitCode, totalSaleValue, totalProfit, margin, profitRows: profitRows.length };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
        return groups;
    }, [rows, view]);

    const grandTotalValue = useMemo(
        () => rows.reduce((s, r) => s + (r.valuation.value ?? 0), 0),
        [rows],
    );
    const grandSaleValue = useMemo(
        () => rows
            .filter((r) => r.costPaise != null && r.pricePaise != null && r.stock > 0)
            .reduce((s, r) => s + (r.stock * (r.pricePaise ?? 0)) / 100, 0),
        [rows],
    );
    const grandProfit = useMemo(
        () => rows
            .filter((r) => r.costPaise != null && r.pricePaise != null && r.stock > 0)
            .reduce(
                (s, r) => s + (((r.pricePaise ?? 0) - (r.costPaise ?? 0)) * r.stock) / 100,
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

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight">Stock Summary</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Live valuation
                        {asOf && (
                            <span className="ml-1">
                                · as at{" "}
                                {new Date(asOf).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            </span>
                        )}
                    </p>
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
            <div className="flex items-center gap-3 flex-wrap text-sm">
                {/* View */}
                <div className="inline-flex items-center rounded-md border border-border p-0.5 bg-card">
                    {(["group", "category", "brand"] as View[]).map((v) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => setView(v)}
                            className={`px-3 py-1 rounded-sm capitalize ${
                                view === v
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-muted"
                            }`}
                        >
                            {v}
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
                            {(["LAST_COST", "WEIGHTED_AVG", "FIFO", "LIFO"] as ValuationMethod[]).map((m) => (
                                <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

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
            {loading && (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-muted-foreground" size={26} />
                </div>
            )}

            {!loading && (
                <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                                <th className="px-3 py-2 text-left font-medium">Particulars</th>
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
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {grouped.length === 0 && (
                                <tr>
                                    <td colSpan={showProfit ? 8 : 4} className="px-3 py-10 text-center text-muted-foreground">
                                        No active products found.
                                    </td>
                                </tr>
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
                                            <td className="px-3 py-2 text-right font-mono">
                                                {g.unitCode != null && g.totalQty > 0 ? `${g.totalQty} ${g.unitCode}` : <span className="text-muted-foreground/50">—</span>}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono text-muted-foreground/50">—</td>
                                            <td className="px-3 py-2 text-right font-mono font-semibold">
                                                {g.totalValue !== 0 ? fmt(g.totalValue) : <span className="text-muted-foreground/50">—</span>}
                                            </td>
                                            {showProfit && (
                                                <>
                                                    <td className="px-3 py-2 text-right font-mono text-muted-foreground/50">—</td>
                                                    <td className="px-3 py-2 text-right font-mono">
                                                        {g.totalSaleValue > 0 ? fmt(g.totalSaleValue) : <span className="text-muted-foreground/50">—</span>}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right font-mono ${g.totalProfit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                                                        {g.profitRows > 0 ? fmt(g.totalProfit) : <span className="text-muted-foreground/50">—</span>}
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono">
                                                        {g.margin != null ? `${g.margin.toFixed(2)}%` : <span className="text-muted-foreground/50">—</span>}
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                        {/* Item rows */}
                                        {isOpen && g.items.map((r) => {
                                            const saleValue = r.pricePaise != null && r.stock > 0 ? (r.stock * r.pricePaise) / 100 : null;
                                            const profit = r.costPaise != null && r.pricePaise != null && r.stock > 0
                                                ? ((r.pricePaise - r.costPaise) * r.stock) / 100
                                                : null;
                                            const margin = saleValue != null && saleValue > 0 && profit != null ? (profit / saleValue) * 100 : null;
                                            return (
                                                <tr key={r.id} className={r.isLow ? "bg-amber-50/40 dark:bg-amber-950/10" : "hover:bg-muted/20"}>
                                                    <td className="px-3 py-1.5 pl-9">
                                                        <span className="text-foreground">{r.name}</span>
                                                        <span className="ml-2 font-mono text-xs text-muted-foreground/70">{r.sku}</span>
                                                        {r.isLow && (
                                                            <span className="ml-2 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-xs">
                                                                <AlertTriangle size={11} />
                                                                Low
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-1.5 text-right font-mono">
                                                        {r.stock} {r.unit.code}
                                                    </td>
                                                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                                        {r.valuation.unitCost > 0
                                                            ? fmt(r.valuation.unitCost)
                                                            : <span className="text-muted-foreground/50">—</span>}
                                                    </td>
                                                    <td className="px-3 py-1.5 text-right font-mono">
                                                        {r.valuation.value > 0
                                                            ? fmt(r.valuation.value)
                                                            : <span className="text-muted-foreground/50">—</span>}
                                                    </td>
                                                    {showProfit && (
                                                        <>
                                                            <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                                                {r.pricePaise != null ? fmt(r.pricePaise / 100) : <span className="text-muted-foreground/50">—</span>}
                                                            </td>
                                                            <td className="px-3 py-1.5 text-right font-mono">
                                                                {saleValue != null ? fmt(saleValue) : <span className="text-muted-foreground/50">—</span>}
                                                            </td>
                                                            <td className={`px-3 py-1.5 text-right font-mono ${profit != null && profit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                                                                {profit != null ? fmt(profit) : <span className="text-muted-foreground/50">—</span>}
                                                            </td>
                                                            <td className="px-3 py-1.5 text-right font-mono">
                                                                {margin != null ? `${margin.toFixed(2)}%` : <span className="text-muted-foreground/50">—</span>}
                                                            </td>
                                                        </>
                                                    )}
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
                                <td className="px-3 py-2 text-right font-mono text-muted-foreground/50">—</td>
                                <td className="px-3 py-2 text-right font-mono text-muted-foreground/50">—</td>
                                <td className="px-3 py-2 text-right font-mono">{fmt(grandTotalValue)}</td>
                                {showProfit && (
                                    <>
                                        <td className="px-3 py-2 text-right font-mono text-muted-foreground/50">—</td>
                                        <td className="px-3 py-2 text-right font-mono">
                                            {grandSaleValue > 0 ? fmt(grandSaleValue) : <span className="text-muted-foreground/50">—</span>}
                                        </td>
                                        <td className={`px-3 py-2 text-right font-mono ${grandProfit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                                            {grandSaleValue > 0 ? fmt(grandProfit) : <span className="text-muted-foreground/50">—</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">
                                            {grandMargin != null ? `${grandMargin.toFixed(2)}%` : <span className="text-muted-foreground/50">—</span>}
                                        </td>
                                    </>
                                )}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {/* Fallback footnote */}
            {!loading && method !== "LAST_COST" && fallbackCount > 0 && (
                <p className="text-xs text-muted-foreground">
                    Valued using {METHOD_LABELS[method]}. {fallbackCount} product{fallbackCount === 1 ? "" : "s"} fell back to last-purchase cost (no receipt history).
                </p>
            )}
        </div>
    );
}
