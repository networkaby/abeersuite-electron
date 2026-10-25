"use client";

import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/shared/lib/format/moneyInr";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { TopBarChart } from "@/modules/bi/components/TopBarChart";

interface ItemRow {
    productId: number; sku: string; name: string;
    category: string | null; brand: string | null;
    qty: number; revenue: number; avgRate: number; unitCost: number;
    cogs: number; profit: number; marginPct: number; costFallback?: string;
}
interface Report {
    costMethod: string;
    branches: BranchOption[];
    rows: ItemRow[];
    totals: { qty: number; revenue: number; cogs: number; profit: number; marginPct: number };
}

type GroupBy = "item" | "category" | "brand";

export default function ItemProfitPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [groupBy, setGroupBy] = useState<GroupBy>("item");

    const { data, status, reload } = useBiQuery<Report>(
        `/api/bi/item-profit?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    const rows = useMemo(() => {
        if (!data) return [];
        if (groupBy === "item") return data.rows;
        const grouped = new Map<string, ItemRow>();
        for (const r of data.rows) {
            const key = (groupBy === "category" ? r.category : r.brand) ?? "(none)";
            const g = grouped.get(key) ?? {
                productId: 0, sku: "", name: key, category: null, brand: null,
                qty: 0, revenue: 0, avgRate: 0, unitCost: 0, cogs: 0, profit: 0, marginPct: 0,
            };
            g.qty += r.qty; g.revenue += r.revenue; g.cogs += r.cogs; g.profit += r.profit;
            grouped.set(key, g);
        }
        return [...grouped.values()]
            .map((g) => ({
                ...g,
                avgRate: g.qty !== 0 ? g.revenue / g.qty : 0,
                marginPct: g.revenue !== 0 ? (g.profit / g.revenue) * 100 : 0,
            }))
            .sort((a, b) => b.profit - a.profit);
    }, [data, groupBy]);

    const belowCost = data?.rows.filter((r) => r.profit < 0).length ?? 0;

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Item-wise Profit</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Margin per {groupBy} for the period — red rows sold below cost
                        {belowCost > 0 ? ` (${belowCost} item${belowCost > 1 ? "s" : ""} below cost)` : ""}.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                    right={
                        <div className="space-y-1">
                            <span className="block text-sm font-medium">Group by</span>
                            <select
                                value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            >
                                <option value="item">Item</option>
                                <option value="category">Collection</option>
                                <option value="brand">Brand</option>
                            </select>
                        </div>
                    }
                />
            </div>

            {status}

            {data && (
                <>
                    {rows.length > 0 && (
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">Top 10 by profit</div>
                            <TopBarChart data={rows.slice(0, 10)} dataKey="profit" name="Profit" height={Math.max(120, Math.min(rows.length, 10) * 30)} />
                        </div>
                    )}

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">{groupBy === "item" ? "Item" : groupBy === "category" ? "Collection" : "Brand"}</th>
                                    {groupBy === "item" && <th className="px-3 py-2 text-left font-medium">Collection</th>}
                                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                    <th className="px-3 py-2 text-right font-medium">Avg Rate</th>
                                    {groupBy === "item" && <th className="px-3 py-2 text-right font-medium">Unit Cost</th>}
                                    <th className="px-3 py-2 text-right font-medium">COGS</th>
                                    <th className="px-3 py-2 text-right font-medium">Profit</th>
                                    <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 ? (
                                    <tr><td colSpan={9} className="py-12 text-center text-muted-foreground text-sm">No sales in this period.</td></tr>
                                ) : rows.map((r) => (
                                    <tr key={groupBy === "item" ? r.productId : r.name} className={`border-b last:border-0 hover:bg-muted/40 ${r.profit < 0 ? "bg-red-500/5" : ""}`}>
                                        <td className="px-3 py-2.5 font-medium text-foreground">
                                            {r.name}
                                            {groupBy === "item" && r.costFallback && (
                                                <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600" title={r.costFallback === "no-cost-basis" ? "No purchase history — COGS treated as 0" : "Cost from opening rate"}>
                                                    {r.costFallback === "no-cost-basis" ? "no cost basis" : "opening rate"}
                                                </span>
                                            )}
                                        </td>
                                        {groupBy === "item" && <td className="px-3 py-2.5 text-muted-foreground text-xs">{r.category ?? "—"}</td>}
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.qty)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(r.revenue)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(r.avgRate)}</td>
                                        {groupBy === "item" && <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(r.unitCost)}</td>}
                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(r.cogs)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono font-semibold ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.marginPct < 0 ? "text-red-600" : ""}`}>{r.marginPct.toFixed(1)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                            {rows.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td className="px-3 py-2.5" colSpan={groupBy === "item" ? 2 : 1}>Total</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(data.totals.qty)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.revenue)}</td>
                                        <td />
                                        {groupBy === "item" && <td />}
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.cogs)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${data.totals.profit < 0 ? "text-red-600" : ""}`}>{fmt(data.totals.profit)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{data.totals.marginPct.toFixed(1)}%</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </>
            )}
        </div>
        </ScrollArea>
    );
}
