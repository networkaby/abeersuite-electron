"use client";

import { fmt } from "@/shared/lib/format/moneyInr";

// Validated categorical palette (dataviz reference instance, slots 1–2; both
// modes pass CVD + contrast checks against white / #1a1a19 surfaces).
// Declared as CSS custom properties via Tailwind arbitrary-property classes so
// the same component follows the app's light/dark theme.
export const BI_CHART_VARS = [
    "[--series-1:#2a78d6]", "[--series-2:#eb6834]",
    "[--grid:#e1e0d9]", "[--ink-muted:#898781]",
    "dark:[--series-1:#3987e5]", "dark:[--series-2:#d95926]", "dark:[--grid:#2c2c2a]",
].join(" ");

export const SERIES_1 = "var(--series-1)";
export const SERIES_2 = "var(--series-2)";
export const GRID = "var(--grid)";
export const INK_MUTED = "var(--ink-muted)";

export const AXIS_TICK = { fill: INK_MUTED, fontSize: 11 } as const;

interface TooltipEntry {
    dataKey?: string | number;
    name?: string | number;
    value?: number | string;
    color?: string;
}

/** Theme-aware tooltip content (recharts' default is hardcoded white). */
export function BiTooltip({ active, payload, label, formatter }: {
    active?: boolean;
    payload?: TooltipEntry[];
    label?: string | number;
    formatter?: (v: number) => string;
}) {
    if (!active || !payload || payload.length === 0) return null;
    const f = formatter ?? ((v: number) => fmt(v));
    return (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
            {label !== undefined && <div className="mb-1 font-medium text-foreground">{label}</div>}
            {payload.map((p) => (
                <div key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                    <span>{p.name}:</span>
                    <span className="font-mono text-foreground">{f(Number(p.value))}</span>
                </div>
            ))}
        </div>
    );
}
