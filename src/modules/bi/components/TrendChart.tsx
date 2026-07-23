"use client";

import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { fmtCompactINR } from "@/modules/bi/lib/format";
import { BI_CHART_VARS, SERIES_1, SERIES_2, GRID, AXIS_TICK, BiTooltip } from "./chartTheme";

const DEFAULT_SERIES = [
    { key: "revenue", name: "Revenue" },
    { key: "profit", name: "Gross Profit" },
];

/** Two thin lines on one ₹ axis. Default series = monthly Revenue vs Gross Profit. */
export function TrendChart({ data, series = DEFAULT_SERIES }: {
    data: ({ label: string } & Record<string, number | string>)[];
    /** Up to two {key, name} line definitions (slots 1–2 of the palette). */
    series?: { key: string; name: string }[];
}) {
    return (
        <div className={`h-64 w-full ${BI_CHART_VARS}`}>
            <ResponsiveContainer>
                <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID }} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={fmtCompactINR} width={52} />
                    <Tooltip content={<BiTooltip />} cursor={{ stroke: GRID }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
                    {series.slice(0, 2).map((s, i) => (
                        <Line
                            key={s.key} type="monotone" dataKey={s.key} name={s.name}
                            stroke={i === 0 ? SERIES_1 : SERIES_2} strokeWidth={2} dot={false} activeDot={{ r: 4 }}
                        />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
