"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { HomeCard, PeriodChips, short, useHomeData } from "./cardKit";

type Month = { month: string; sales: number; netProfit: number };

// Mirrors TREND_MONTHS in modules/home/lib/businessHealth.ts (server-only).
const MONTH_OPTIONS = [
    { value: 6, label: "6 months" },
    { value: 12, label: "12 months" },
] as const;

function monthLabel(ym: string, withYear = false): string {
    return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", {
        month: "short",
        ...(withYear ? { year: "numeric" } : {}),
        timeZone: "UTC",
    });
}

function margin(m: Month): string {
    return m.sales ? `${((m.netProfit / m.sales) * 100).toFixed(1)}%` : "—";
}

/** Sales (after returns, before GST) as bars and the P&L's net profit as a line, month by month. */
export default function SalesProfitCard() {
    const [months, setMonths] = useState<6 | 12>(12);
    const { data, failed, retry } = useHomeData<{ points: Month[] }>(`/api/home/monthly-trend?months=${months}`);
    const points = data?.points;
    const current = points?.at(-1);

    return (
        <HomeCard
            icon={<BarChart3 size={16} className="text-blue-600" />}
            title="Sales and net profit, monthly"
            control={<PeriodChips options={MONTH_OPTIONS} value={months} onChange={setMonths} />}
            failed={failed}
            onRetry={retry}
        >
            <p className="mt-2 text-xs text-muted-foreground">
                {current ? (
                    <>
                        This month: sales <b className="font-mono text-foreground">{short(current.sales)}</b> · net profit{" "}
                        <b className={`font-mono ${current.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {short(current.netProfit)}
                        </b>{" "}
                        ({margin(current)})
                    </>
                ) : "…"}
            </p>
            <div className="mt-2 h-56">
                {points && (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                            <XAxis dataKey="month" tickFormatter={(v) => monthLabel(v)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                            <YAxis tickFormatter={(v) => short(Number(v))} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={64} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Tooltip
                                cursor={{ fillOpacity: 0.1 }}
                                content={({ active, payload }) => {
                                    const row = active ? (payload?.[0]?.payload as Month | undefined) : undefined;
                                    if (!row) return null;
                                    return (
                                        <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                                            <p className="text-muted-foreground">{monthLabel(row.month, true)}</p>
                                            <p className="text-foreground">Sales {formatInr(row.sales, 0)}</p>
                                            <p className={row.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}>
                                                Net profit {formatInr(row.netProfit, 0)} ({margin(row)})
                                            </p>
                                        </div>
                                    );
                                }}
                            />
                            <Bar dataKey="sales" name="Sales" fill="#85B7EB" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                            <Line dataKey="netProfit" name="Net profit" stroke="#1D9E75" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                )}
            </div>
        </HomeCard>
    );
}
