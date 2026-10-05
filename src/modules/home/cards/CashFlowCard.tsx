"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeftRight } from "lucide-react";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { formatDateCompact } from "@/shared/lib/format/formatDate";
import { DAY_PERIODS, HomeCard, PeriodChips, dayLabel, short, signedInr, useHomeData } from "./cardKit";

type Day = { date: string; inflow: number; outflow: number };

/** Money in and out of cash + bank — green bars up, red bars down, per day. */
export default function CashFlowCard() {
    const [days, setDays] = useState<number>(15);
    const { data, failed, retry } = useHomeData<{ points: Day[] }>(`/api/home/cash-flow?days=${days}`);
    const points = data?.points;
    const totalIn = points?.reduce((s, d) => s + d.inflow, 0) ?? 0;
    const totalOut = points?.reduce((s, d) => s + d.outflow, 0) ?? 0;
    // Out is drawn below the line.
    const chart = points?.map((d) => ({ ...d, out: -d.outflow }));

    return (
        <HomeCard
            icon={<ArrowLeftRight size={16} className="text-emerald-600" />}
            title="Cash flow"
            control={<PeriodChips options={DAY_PERIODS} value={days} onChange={setDays} />}
            failed={failed}
            onRetry={retry}
        >
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Figure label="Money in" value={points ? short(totalIn) : "…"} tone="text-emerald-600" />
                <Figure label="Money out" value={points ? short(totalOut) : "…"} tone="text-red-600" />
                <Figure label="Net" value={points ? signedInr(totalIn - totalOut) : "…"} tone="text-foreground" />
            </div>
            <div className="mt-2 h-44">
                {chart && (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chart} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                            <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
                            <YAxis tickFormatter={(v) => short(Number(v))} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={64} />
                            <ReferenceLine y={0} className="stroke-muted-foreground" />
                            <Tooltip
                                cursor={{ fillOpacity: 0.1 }}
                                content={({ active, payload }) => {
                                    const row = active ? (payload?.[0]?.payload as Day | undefined) : undefined;
                                    if (!row) return null;
                                    return (
                                        <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                                            <p className="text-muted-foreground">{formatDateCompact(row.date)}</p>
                                            <p className="text-emerald-600">In {formatInr(row.inflow, 0)}</p>
                                            <p className="text-red-600">Out {formatInr(row.outflow, 0)}</p>
                                            <p className="font-semibold text-foreground">Net {signedInr(row.inflow - row.outflow)}</p>
                                        </div>
                                    );
                                }}
                            />
                            <Bar dataKey="inflow" stackId="f" fill="#1D9E75" isAnimationActive={false} />
                            <Bar dataKey="out" stackId="f" fill="#E24B4A" fillOpacity={0.8} isAnimationActive={false} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
                Cash and bank only. Moving money between your own cash and bank is not counted.
            </p>
        </HomeCard>
    );
}

function Figure({ label, value, tone }: { label: string; value: string; tone: string }) {
    return (
        <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
            <p className="text-muted-foreground">{label}</p>
            <p className={`font-mono text-sm font-semibold ${tone}`}>{value}</p>
        </div>
    );
}
