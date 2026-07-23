"use client";

import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { fmtCompactINR } from "@/modules/bi/lib/format";
import { BI_CHART_VARS, SERIES_1, GRID, AXIS_TICK, BiTooltip } from "./chartTheme";

/** Horizontal top-N ranking — one measure, one series, rounded data ends. */
export function TopBarChart<T extends { name: string }>({ data, dataKey, name, height = 260 }: {
    data: T[];
    /** Measure key on each row (e.g. "profit"). Rows also need a `name`. */
    dataKey: string;
    name: string;
    height?: number;
}) {
    return (
        <div className={`w-full ${BI_CHART_VARS}`} style={{ height }}>
            <ResponsiveContainer>
                <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barSize={16}>
                    <CartesianGrid stroke={GRID} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={fmtCompactINR} />
                    <YAxis
                        type="category" dataKey="name" width={140}
                        tick={{ ...AXIS_TICK, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }}
                    />
                    <Tooltip content={<BiTooltip />} cursor={{ fill: "var(--grid)", opacity: 0.35 }} />
                    <Bar dataKey={dataKey} name={name} fill={SERIES_1} radius={[0, 4, 4, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
