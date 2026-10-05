"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { formatDateCompact } from "@/shared/lib/format/formatDate";
import { DAY_PERIODS, HomeCard, PeriodChips, Stat, dayLabel, short, signedInr, useHomeData } from "./cardKit";

type Point = { date: string; workingCapital: number; liquidFund: number; inventory: number };
type Metric = "workingCapital" | "liquidFund" | "inventory";

const METRICS = {
    workingCapital: { key: "workingCapital", label: "Working capital", color: "#378ADD" },
    liquidFund: { key: "liquidFund", label: "Liquid fund (cash + bank)", color: "#1D9E75" },
    inventory: { key: "inventory", label: "Inventory value", color: "#BA7517" },
} as const satisfies Record<Metric, { key: Metric; label: string; color: string }>;

/** One Business health figure as its own Home card, with its own period. */
export default function BusinessHealthCard({ metric }: { metric: Metric }) {
    const [days, setDays] = useState<number>(15);
    const { data, failed, retry } = useHomeData<{ points: Point[] }>(`/api/home/business-health?days=${days}`);
    const m = METRICS[metric];

    return (
        <HomeCard
            icon={<TrendingUp size={16} style={{ color: m.color }} />}
            title={m.label}
            control={<PeriodChips options={DAY_PERIODS} value={days} onChange={setDays} />}
            failed={failed}
            onRetry={retry}
        >
            <MetricTile metric={m} points={data?.points} failed={failed} />
        </HomeCard>
    );
}

function MetricTile({
    metric,
    points,
    failed,
}: {
    metric: (typeof METRICS)[Metric];
    points: Point[] | undefined;
    failed: boolean;
}) {
    const values = points?.map((p) => p[metric.key]) ?? [];
    const first = values[0];
    const last = values.at(-1);
    const delta = first != null && last != null ? last - first : null;
    const pct = delta != null && first ? (delta / Math.abs(first)) * 100 : null;
    const up = (delta ?? 0) >= 0;

    const hiIdx = values.length ? values.indexOf(Math.max(...values)) : -1;
    const loIdx = values.length ? values.indexOf(Math.min(...values)) : -1;
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
    // A flat line (moved < 1% of its size) would print the same "₹9.42 L" on
    // every tick — show exact rupees instead.
    const span = values.length ? Math.max(...values) - Math.min(...values) : 0;
    const flat = last != null && span < Math.abs(last) * 0.01;
    const tick = (v: number) => (flat ? formatInr(v, 0) : short(v));

    // Each point carries its move from the previous sampled day, for the tooltip.
    const data = points?.map((p, i) => ({ ...p, prev: i > 0 ? p[metric.key] - points[i - 1][metric.key] : null }));

    return (
        <div className="mt-3">
            <div className="flex items-start justify-between gap-2">
                <div>
                                        <p className="font-mono text-xl font-semibold text-foreground">
                        {last != null ? short(last) : failed ? "—" : "…"}
                    </p>
                </div>
                {delta != null && points && (
                    <div className="text-right">
                        <p className={`flex items-center justify-end text-xs font-medium ${up ? "text-emerald-600" : "text-red-600"}`}>
                            {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                            {signedInr(delta)}{pct != null && ` (${Math.abs(pct).toFixed(1)}%)`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">vs {dayLabel(points[0].date)}</p>
                    </div>
                )}
            </div>

            <div className="mt-2 h-44">
                {data && (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                            <XAxis
                                dataKey="date"
                                tickFormatter={dayLabel}
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                minTickGap={24}
                            />
                            <YAxis
                                domain={["auto", "auto"]}
                                tickFormatter={(v) => tick(Number(v))}
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                width={flat ? 78 : 64}
                            />
                            {first != null && (
                                <ReferenceLine
                                    y={first}
                                    strokeDasharray="2 4"
                                    className="stroke-muted-foreground"
                                    label={{ value: `start ${short(first)}`, position: "insideBottomRight", fontSize: 10 }}
                                />
                            )}
                            <Tooltip
                                content={({ active, payload }) => {
                                    const row = active ? payload?.[0]?.payload : null;
                                    if (!row) return null;
                                    return (
                                        <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                                            <p className="text-muted-foreground">{formatDateCompact(row.date)}</p>
                                            <p className="font-mono font-semibold text-foreground">{formatInr(row[metric.key], 0)}</p>
                                            {row.prev != null && (
                                                <p className={row.prev >= 0 ? "text-emerald-600" : "text-red-600"}>
                                                    {signedInr(row.prev)} from previous point
                                                </p>
                                            )}
                                        </div>
                                    );
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey={metric.key}
                                stroke={metric.color}
                                fill={metric.color}
                                fillOpacity={0.12}
                                strokeWidth={2}
                                dot={{ r: 2.5, fill: metric.color, strokeWidth: 0 }}
                                activeDot={{ r: 4 }}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>

            {points && first != null && avg != null && (
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
                    <Stat label="Start" value={short(first)} />
                    <Stat label="Highest" value={short(values[hiIdx])} note={dayLabel(points[hiIdx].date)} />
                    <Stat label="Lowest" value={short(values[loIdx])} note={dayLabel(points[loIdx].date)} />
                    <Stat label="Average" value={short(avg)} />
                </div>
            )}
        </div>
    );
}
