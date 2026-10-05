"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { formatDateCompact } from "@/shared/lib/format/formatDate";

type Point = { date: string; workingCapital: number; liquidFund: number; inventory: number };
type Metric = "workingCapital" | "liquidFund" | "inventory";

// Mirrors HEALTH_PERIODS in modules/home/lib/businessHealth.ts (server-only).
const PERIODS = [
    { days: 7, label: "7 days" },
    { days: 15, label: "15 days" },
    { days: 30, label: "30 days" },
    { days: 90, label: "90 days" },
    { days: 365, label: "1 year" },
] as const;

const METRICS: { key: Metric; label: string; color: string }[] = [
    { key: "workingCapital", label: "Working capital", color: "#378ADD" },
    { key: "liquidFund", label: "Liquid fund (cash + bank)", color: "#1D9E75" },
    { key: "inventory", label: "Inventory value", color: "#BA7517" },
];

/** Lakh / thousand shorthand for the big figure — the tooltip shows the exact amount. */
function short(n: number): string {
    const a = Math.abs(n);
    const sign = n < 0 ? "−" : "";
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
    if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)} k`;
    return `${sign}₹${Math.round(a)}`;
}

export default function BusinessHealthCard() {
    const [days, setDays] = useState<number>(15);
    // Every period fetched this visit is kept, so switching back paints at once.
    const [byPeriod, setByPeriod] = useState<Record<number, Point[]>>({});
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let live = true;
        axios
            .get<{ points: Point[] }>("/api/home/business-health", { params: { days } })
            .then(({ data }) => live && setByPeriod((m) => ({ ...m, [days]: data.points })))
            .catch(() => live && setFailed(true));
        return () => { live = false; };
    }, [days, attempt]);

    const points = byPeriod[days];

    return (
        <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
                <TrendingUp size={16} className="text-emerald-600" />
                <h2 className="text-sm font-semibold text-foreground">Business health</h2>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
                {PERIODS.map((p) => (
                    <button
                        key={p.days}
                        type="button"
                        onClick={() => { setFailed(false); setDays(p.days); }}
                        className={[
                            "rounded-md border px-2.5 py-0.5 text-xs transition-colors",
                            p.days === days
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:bg-muted/60",
                        ].join(" ")}
                    >
                        {p.label}
                    </button>
                ))}
            </div>

            {failed && !points && (
                <p className="mt-3 text-xs text-red-600">
                    Couldn&apos;t load the figures.{" "}
                    <button type="button" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }} className="underline">
                        Retry
                    </button>
                </p>
            )}

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                {METRICS.map((m) => (
                    <MetricTile key={m.key} metric={m} points={points} failed={failed} />
                ))}
            </div>
        </section>
    );
}

/** "21 Sep" — compact axis / summary date. */
function dayLabel(iso: string): string {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function signedInr(n: number): string {
    return `${n >= 0 ? "+" : "−"}${formatInr(Math.abs(n), 0)}`;
}

function MetricTile({
    metric,
    points,
    failed,
}: {
    metric: (typeof METRICS)[number];
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
        <div className="rounded-lg bg-muted/40 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <p className="text-xs text-muted-foreground">{metric.label}</p>
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
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                    <Stat label="Start" value={short(first)} />
                    <Stat label="Highest" value={short(values[hiIdx])} note={dayLabel(points[hiIdx].date)} />
                    <Stat label="Lowest" value={short(values[loIdx])} note={dayLabel(points[loIdx].date)} />
                    <Stat label="Average" value={short(avg)} />
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div className="rounded bg-background/60 px-2 py-1">
            <p className="text-muted-foreground">{label}</p>
            <p className="font-mono font-semibold text-foreground">
                {value} {note && <span className="font-sans font-normal text-muted-foreground">{note}</span>}
            </p>
        </div>
    );
}
