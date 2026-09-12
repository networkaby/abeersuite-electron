"use client";

import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";

interface TurnoverRow {
    productId: number; sku: string; name: string; category: string | null; unit: string | null;
    cogs: number; avgInventory: number; turnover: number | null;
    daysOfInventory: number | null; stock: number; stockValue: number;
}
interface Report {
    periodDays: number;
    costMethod: string;
    branches: BranchOption[];
    rows: TurnoverRow[];
}

type GroupBy = "item" | "category";
type SortDir = "slowest" | "fastest";

export default function StockTurnoverPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [groupBy, setGroupBy] = useState<GroupBy>("item");
    const [sortDir, setSortDir] = useState<SortDir>("slowest");

    const { data, status, reload } = useBiQuery<Report>(
        `/api/bi/stock-turnover?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    const rows = useMemo(() => {
        if (!data) return [];
        let out: TurnoverRow[];
        if (groupBy === "item") {
            out = [...data.rows];
        } else {
            const grouped = new Map<string, TurnoverRow>();
            for (const r of data.rows) {
                const key = r.category ?? "(none)";
                const g = grouped.get(key) ?? {
                    productId: 0, sku: "", name: key, category: null, unit: null,
                    cogs: 0, avgInventory: 0, turnover: null, daysOfInventory: null, stock: 0, stockValue: 0,
                };
                g.cogs += r.cogs; g.avgInventory += r.avgInventory; g.stock += r.stock; g.stockValue += r.stockValue;
                grouped.set(key, g);
            }
            out = [...grouped.values()].map((g) => {
                const turnover = g.avgInventory > 0 ? g.cogs / g.avgInventory : null;
                return {
                    ...g,
                    turnover: turnover !== null ? Math.round(turnover * 100) / 100 : null,
                    daysOfInventory: turnover && turnover > 0 ? Math.round(data.periodDays / turnover) : null,
                };
            });
        }
        out.sort((a, b) => sortDir === "slowest"
            ? (a.turnover ?? -1) - (b.turnover ?? -1) || b.stockValue - a.stockValue
            : (b.turnover ?? -1) - (a.turnover ?? -1));
        return out;
    }, [data, groupBy, sortDir]);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Stock Turnover</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Turnover = period COGS ÷ average inventory value ({data?.periodDays ?? "—"} days). Low turnover with high stock value = money stuck.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                    right={
                        <>
                            <div className="space-y-1">
                                <span className="block text-sm font-medium">Group by</span>
                                <select
                                    value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                >
                                    <option value="item">Item</option>
                                    <option value="category">Category</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <span className="block text-sm font-medium">Show</span>
                                <select
                                    value={sortDir} onChange={(e) => setSortDir(e.target.value as SortDir)}
                                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                >
                                    <option value="slowest">Slowest first</option>
                                    <option value="fastest">Fastest first</option>
                                </select>
                            </div>
                        </>
                    }
                />
            </div>

            {status}

            {data && (
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="border-b bg-muted text-xs text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">{groupBy === "item" ? "Item" : "Category"}</th>
                                <th className="px-3 py-2 text-right font-medium">COGS</th>
                                <th className="px-3 py-2 text-right font-medium">Avg Inventory</th>
                                <th className="px-3 py-2 text-right font-medium">Turnover</th>
                                <th className="px-3 py-2 text-right font-medium">Days of Inventory</th>
                                <th className="px-3 py-2 text-right font-medium">Stock Now</th>
                                <th className="px-3 py-2 text-right font-medium">Stock Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr><td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">No stock activity in this period.</td></tr>
                            ) : rows.map((r) => (
                                <tr key={groupBy === "item" ? r.productId : r.name} className={`border-b last:border-0 hover:bg-muted/40 ${r.turnover === null && r.stockValue > 0 ? "bg-red-500/5" : ""}`}>
                                    <td className="px-3 py-2.5">
                                        <span className="font-medium text-foreground">{r.name}</span>
                                        {groupBy === "item" && r.category && <span className="ml-2 text-xs text-muted-foreground">{r.category}</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(r.cogs)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(r.avgInventory)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{r.turnover !== null ? r.turnover.toFixed(1) : "0.0"}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{r.daysOfInventory !== null ? r.daysOfInventory : <span className="text-red-600">∞</span>}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.stock)}{r.unit ? ` ${r.unit}` : ""}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(r.stockValue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
        </ScrollArea>
    );
}
