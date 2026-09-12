"use client";

import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { ParetoChart } from "@/modules/bi/components/ParetoChart";

interface CustomerRow {
    accountId: number; name: string; bills: number; qty: number;
    revenue: number; cogs: number; profit: number; marginPct: number;
}
interface Report {
    costMethod: string;
    branches: BranchOption[];
    rows: CustomerRow[];
    totals: { bills: number; qty: number; revenue: number; cogs: number; profit: number; marginPct: number };
}

type RankBy = "profit" | "revenue" | "bills";
const RANK_LABELS: Record<RankBy, string> = { profit: "Profit", revenue: "Revenue", bills: "Frequency (bills)" };
const N_OPTIONS = [10, 25, 50, 0] as const; // 0 = All

export default function TopCustomersPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [rankBy, setRankBy] = useState<RankBy>("profit");
    const [topN, setTopN] = useState<number>(10);

    const { data, status, reload } = useBiQuery<Report>(
        `/api/bi/customer-profit?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    const ranked = useMemo(() => {
        if (!data) return [];
        const sorted = [...data.rows].sort((a, b) => b[rankBy] - a[rankBy]);
        const metricTotal = sorted.reduce((s, r) => s + r[rankBy], 0);
        let cumulative = 0;
        const rows = sorted.map((r, i) => {
            const sharePct = metricTotal > 0 ? (r[rankBy] / metricTotal) * 100 : 0;
            cumulative += sharePct;
            return { ...r, rank: i + 1, sharePct, cumulativePct: Math.min(cumulative, 100) };
        });
        return topN > 0 ? rows.slice(0, topN) : rows;
    }, [data, rankBy, topN]);

    const topShare = ranked.length > 0 ? ranked[ranked.length - 1].cumulativePct : 0;

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Top Customers</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Rank by profit, revenue or visit frequency — share bars show concentration
                        {ranked.length > 0 ? ` (top ${ranked.length} = ${topShare.toFixed(0)}% of ${RANK_LABELS[rankBy].toLowerCase()})` : ""}.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                    right={
                        <>
                            <div className="space-y-1">
                                <span className="block text-sm font-medium">Rank by</span>
                                <select
                                    value={rankBy} onChange={(e) => setRankBy(e.target.value as RankBy)}
                                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                >
                                    {(Object.keys(RANK_LABELS) as RankBy[]).map((k) => (
                                        <option key={k} value={k}>{RANK_LABELS[k]}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <span className="block text-sm font-medium">Top</span>
                                <select
                                    value={topN} onChange={(e) => setTopN(Number(e.target.value))}
                                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                >
                                    {N_OPTIONS.map((n) => (
                                        <option key={n} value={n}>{n === 0 ? "All" : n}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    }
                />
            </div>

            {status}

            {data && (
                <>
                    {ranked.length > 0 && (
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">
                                Share of {RANK_LABELS[rankBy].toLowerCase()} — per customer and cumulative
                            </div>
                            <ParetoChart data={ranked.slice(0, 25).map((r) => ({ name: r.name, sharePct: r.sharePct, cumulativePct: r.cumulativePct }))} />
                        </div>
                    )}

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">#</th>
                                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                                    <th className="px-3 py-2 text-right font-medium">Bills</th>
                                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                    <th className="px-3 py-2 text-right font-medium">Profit</th>
                                    <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                    <th className="px-3 py-2 text-right font-medium">Share %</th>
                                    <th className="px-3 py-2 text-right font-medium">Cumulative %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ranked.length === 0 ? (
                                    <tr><td colSpan={9} className="py-12 text-center text-muted-foreground text-sm">No sales in this period.</td></tr>
                                ) : ranked.map((r) => (
                                    <tr key={r.accountId} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-3 py-2.5 text-muted-foreground">{r.rank}</td>
                                        <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.bills}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.qty)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(r.revenue)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono font-semibold ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
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
