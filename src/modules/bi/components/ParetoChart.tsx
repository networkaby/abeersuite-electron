"use client";

import {
    ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { BI_CHART_VARS, SERIES_1, SERIES_2, GRID, AXIS_TICK, BiTooltip } from "./chartTheme";

/**
 * Pareto view for top-N rankings on ONE percentage axis (0–100):
 * bars = each entry's share % of the chosen metric, line = cumulative share %.
 * (Both series share the % scale on purpose — no dual axis.)
 */
export function ParetoChart({ data }: {
    data: { name: string; sharePct: number; cumulativePct: number }[];
}) {
    return (
        <div className={`h-72 w-full ${BI_CHART_VARS}`}>
            <ResponsiveContainer>
                <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 24, left: 4 }} barSize={18}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis
                        dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                        axisLine={{ stroke: GRID }} interval={0} angle={-30} textAnchor="end" height={56}
                    />
                    <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} width={40} />
                    <Tooltip content={<BiTooltip formatter={(v) => `${v.toFixed(1)}%`} />} cursor={{ fill: "var(--grid)", opacity: 0.35 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="sharePct" name="Share %" fill={SERIES_1} radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="cumulativePct" name="Cumulative %" stroke={SERIES_2} strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}
