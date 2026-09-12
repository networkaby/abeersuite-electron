"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { TrendChart } from "@/modules/bi/components/TrendChart";
import { SimpleBarChart } from "@/modules/bi/components/SimpleBarChart";

interface MonthRow {
    key: string; label: string;
    revenue: number; profit: number; marginPct: number;
    lastYearRevenue: number; yoyPct: number | null;
}
interface Report {
    branches: BranchOption[];
    months: MonthRow[];
    dayOfWeek: { label: string; revenue: number; profit: number }[];
}

export default function SalesTrendPage() {
    const [from, setFrom] = useState(toIsoDate(indianFiscalYearStart()));
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");

    const { data, status, reload } = useBiQuery<Report>(
        `/api/bi/sales-trend?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Sales Trend & Seasonality</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Monthly revenue vs the same months last year, and which weekdays actually earn.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                />
            </div>

            {status}

            {data && (
                <>
                    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                        <div className="mb-2 text-sm font-medium text-foreground">Revenue — this year vs last year</div>
                        <TrendChart
                            data={data.months.map((m) => ({ label: m.label, thisYear: m.revenue, lastYear: m.lastYearRevenue }))}
                            series={[{ key: "thisYear", name: "This year" }, { key: "lastYear", name: "Last year" }]}
                        />
                    </div>

                    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                        <div className="mb-2 text-sm font-medium text-foreground">Revenue by day of week</div>
                        <SimpleBarChart data={data.dayOfWeek} series={[{ key: "revenue", name: "Revenue" }]} height={200} />
                    </div>

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Month</th>
                                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                    <th className="px-3 py-2 text-right font-medium">Last Year</th>
                                    <th className="px-3 py-2 text-right font-medium">YoY %</th>
                                    <th className="px-3 py-2 text-right font-medium">Profit</th>
                                    <th className="px-3 py-2 text-right font-medium">Margin %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.months.map((m) => (
                                    <tr key={m.key} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-3 py-2.5 font-medium text-foreground">{m.label}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(m.revenue)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{fmt(m.lastYearRevenue)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${m.yoyPct === null ? "text-muted-foreground/65" : m.yoyPct < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                            {m.yoyPct === null ? "—" : `${m.yoyPct > 0 ? "+" : ""}${m.yoyPct.toFixed(1)}%`}
                                        </td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${m.profit < 0 ? "text-red-600" : ""}`}>{fmt(m.profit)}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${m.marginPct < 0 ? "text-red-600" : ""}`}>{m.marginPct.toFixed(1)}%</td>
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
