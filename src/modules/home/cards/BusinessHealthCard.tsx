"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
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

            <div className="mt-3 space-y-2">
                {METRICS.map((m) => (
                    <MetricTile key={m.key} metric={m} points={points} failed={failed} />
                ))}
            </div>
        </section>
    );
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
    const first = points?.[0]?.[metric.key];
    const last = points?.at(-1)?.[metric.key];
    const change = first != null && last != null && first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
    const up = (change ?? 0) >= 0;

    return (
        <div className="rounded-lg bg-muted/40 px-3 py-2.5">
            <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">{metric.label}</span>
                {change != null && (
                    <span className={`flex items-center text-xs ${up ? "text-emerald-600" : "text-red-600"}`}>
                        {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        {Math.abs(change).toFixed(1)}%
                    </span>
                )}
            </div>
            <p className="font-mono text-lg font-semibold text-foreground">
                {last != null ? short(last) : failed ? "—" : "…"}
            </p>
            <div className="h-12">
                {points && (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                            <YAxis hide domain={["dataMin", "dataMax"]} />
                            <Tooltip
                                formatter={(v) => [formatInr(Number(v), 0), metric.label]}
                                labelFormatter={(_, p) => (p?.[0] ? formatDateCompact(p[0].payload.date) : "")}
                                contentStyle={{ fontSize: 12 }}
                            />
                            <Area
                                type="monotone"
                                dataKey={metric.key}
                                stroke={metric.color}
                                fill={metric.color}
                                fillOpacity={0.12}
                                strokeWidth={1.8}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}
