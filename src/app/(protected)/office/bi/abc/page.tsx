"use client";

import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/shared/lib/format/moneyInr";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { ParetoChart } from "@/modules/bi/components/ParetoChart";

// A = first 80% of the metric, B = next 15% (to 95%), C = the tail.
const A_CUTOFF = 80;
const B_CUTOFF = 95;

interface ItemRow {
    productId: number; sku: string; name: string;
    category: string | null; brand: string | null;
    qty: number; revenue: number; cogs: number; profit: number; marginPct: number;
}
interface Report {
    costMethod: string;
    branches: BranchOption[];
    rows: ItemRow[];
}

type Metric = "revenue" | "profit";
type AbcClass = "A" | "B" | "C" | "—";

const CLASS_BADGES: Record<AbcClass, string> = {
    A: "bg-emerald-500/15 text-emerald-600",
    B: "bg-amber-500/15 text-amber-600",
    C: "bg-red-500/15 text-red-600",
    "—": "bg-muted text-muted-foreground",
};

export default function AbcPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [metric, setMetric] = useState<Metric>("revenue");

    const { data, status, reload } = useBiQuery<Report>(
        `/api/bi/item-profit?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    const { rows, summary } = useMemo(() => {
        if (!data) return { rows: [], summary: [] };
        // Classify positive-metric items only; ≤0 rows (returns-heavy) get "—".
        const positive = data.rows.filter((r) => r[metric] > 0).sort((a, b) => b[metric] - a[metric]);
        const rest = data.rows.filter((r) => r[metric] <= 0);
        const total = positive.reduce((s, r) => s + r[metric], 0);
        let cumulative = 0;
        const classified = positive.map((r, i) => {
            const sharePct = total > 0 ? (r[metric] / total) * 100 : 0;
            cumulative += sharePct;
            const abcClass: AbcClass = cumulative <= A_CUTOFF ? "A" : cumulative <= B_CUTOFF ? "B" : "C";
            return { ...r, rank: i + 1, sharePct, cumulativePct: Math.min(cumulative, 100), abcClass };
        });
        const unclassified = rest.map((r, i) => ({
            ...r, rank: classified.length + i + 1, sharePct: 0, cumulativePct: 100, abcClass: "—" as AbcClass,
        }));
        const all = [...classified, ...unclassified];
        const summary = (["A", "B", "C"] as AbcClass[]).map((cls) => {
            const subset = classified.filter((r) => r.abcClass === cls);
            return {
                cls,
                items: subset.length,
                metricTotal: subset.reduce((s, r) => s + r[metric], 0),
                sharePct: subset.reduce((s, r) => s + r.sharePct, 0),
            };
        });
        return { rows: all, summary };
    }, [data, metric]);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">ABC Analysis</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        A = first {A_CUTOFF}% of {metric}, B = next {B_CUTOFF - A_CUTOFF}%, C = the tail. A-items must never stock out; C-items are drop candidates.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                    right={
                        <div className="space-y-1">
                            <span className="block text-sm font-medium">Rank by</span>
                            <select
                                value={metric} onChange={(e) => setMetric(e.target.value as Metric)}
                                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            >
                                <option value="revenue">Revenue</option>
                                <option value="profit">Profit</option>
                            </select>
                        </div>
                    }
                />
            </div>

            {status}

            {data && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {summary.map((s) => (
                            <div key={s.cls} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                                <div className="flex items-center gap-2">
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CLASS_BADGES[s.cls]}`}>Class {s.cls}</span>
                                    <span className="text-xs text-muted-foreground">{s.items} items</span>
                                </div>
                                <div className="mt-1 text-lg font-mono font-semibold text-foreground">{fmt(s.metricTotal)}</div>
                                <div className="text-[11px] text-muted-foreground">{s.sharePct.toFixed(1)}% of {metric}</div>
                            </div>
                        ))}
                    </div>

                    {rows.length > 0 && (
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">Contribution — per item and cumulative (top 25)</div>
                            <ParetoChart data={rows.slice(0, 25).map((r) => ({ name: r.name, sharePct: r.sharePct, cumulativePct: r.cumulativePct }))} />
                        </div>
                    )}

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">#</th>
                                    <th className="px-3 py-2 text-left font-medium">Item</th>
                                    <th className="px-3 py-2 text-left font-medium">Class</th>
                                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                    <th className="px-3 py-2 text-right font-medium">Profit</th>
                                    <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                    <th className="px-3 py-2 text-right font-medium">Share %</th>
                                    <th className="px-3 py-2 text-right font-medium">Cumulative %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 ? (
                                    <tr><td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">No sales in this period.</td></tr>
                                ) : rows.map((r) => (
                                    <tr key={r.productId} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-3 py-2.5 text-muted-foreground">{r.rank}</td>
                                        <td className="px-3 py-2.5">
                                            <span className="font-medium text-foreground">{r.name}</span>
                                            {r.category && <span className="ml-2 text-xs text-muted-foreground">{r.category}</span>}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CLASS_BADGES[r.abcClass]}`}>{r.abcClass}</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(r.revenue)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.marginPct < 0 ? "text-red-600" : ""}`}>{r.marginPct.toFixed(1)}%</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{r.sharePct.toFixed(1)}%</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{r.cumulativePct.toFixed(1)}%</td>
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
