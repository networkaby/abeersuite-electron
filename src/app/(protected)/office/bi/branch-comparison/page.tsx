"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtQty } from "@/modules/bi/lib/format";
import { SimpleBarChart } from "@/modules/bi/components/SimpleBarChart";

interface BranchRow {
    branchId: string | null; name: string; bills: number; qty: number;
    revenue: number; sharePct: number; cogs: number; profit: number; marginPct: number; avgBill: number;
}
interface Report { rows: BranchRow[] }

export default function BranchComparisonPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));

    const { data, loading, reload } = useBiQuery<Report>(`/api/bi/branch-comparison?from=${from}&to=${to}`);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Branch Comparison</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Revenue, margin, bill count and average bill per branch for the period.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>From</Label>
                        <TallyDateInput value={from} onValueChange={setFrom} className="w-auto" />
                    </div>
                    <div className="space-y-1">
                        <Label>To</Label>
                        <TallyDateInput value={to} onValueChange={setTo} monthMode="end" className="w-auto" />
                    </div>
                    <Button onClick={reload}>Refresh</Button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    {data.rows.length > 0 && (
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">Revenue and profit per branch</div>
                            <SimpleBarChart
                                data={data.rows.map((r) => ({ label: r.name, revenue: r.revenue, profit: r.profit }))}
                                series={[{ key: "revenue", name: "Revenue" }, { key: "profit", name: "Gross Profit" }]}
                            />
                        </div>
                    )}

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Branch</th>
                                    <th className="px-3 py-2 text-right font-medium">Bills</th>
                                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                    <th className="px-3 py-2 text-right font-medium">Share %</th>
                                    <th className="px-3 py-2 text-right font-medium">Profit</th>
                                    <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                    <th className="px-3 py-2 text-right font-medium">Avg Bill</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 ? (
                                    <tr><td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">No sales in this period.</td></tr>
                                ) : data.rows.map((r) => (
                                    <tr key={r.branchId ?? "none"} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{r.bills}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmtQty(r.qty)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(r.revenue)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{r.sharePct.toFixed(1)}%</td>
                                        <td className={`px-3 py-2.5 text-right font-mono font-semibold ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${r.marginPct < 0 ? "text-red-600" : ""}`}>{r.marginPct.toFixed(1)}%</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(r.avgBill)}</td>
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
