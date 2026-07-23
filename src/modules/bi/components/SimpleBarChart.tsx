"use client";

import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { fmtCompactINR } from "@/modules/bi/lib/format";
import { BI_CHART_VARS, SERIES_1, SERIES_2, GRID, AXIS_TICK, BiTooltip } from "./chartTheme";

/** Vertical bars, one ₹ axis, 1–2 series (palette slots 1–2). */
export function SimpleBarChart({ data, series, height = 240 }: {
    data: ({ label: string } & Record<string, number | string>)[];
    series: { key: string; name: string }[];
    height?: number;
}) {
    return (
        <div className={`w-full ${BI_CHART_VARS}`} style={{ height }}>
            <ResponsiveContainer>
                <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barSize={18} barGap={2}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID }} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={fmtCompactINR} width={52} />
                    <Tooltip content={<BiTooltip />} cursor={{ fill: "var(--grid)", opacity: 0.35 }} />
                    {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                    {series.slice(0, 2).map((s, i) => (
                        <Bar key={s.key} dataKey={s.key} name={s.name} fill={i === 0 ? SERIES_1 : SERIES_2} radius={[4, 4, 0, 0]} />
                    ))}
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
