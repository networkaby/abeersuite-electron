"use client";

import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/shared/lib/format/moneyInr";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { useBiQuery } from "@/modules/bi/hooks/useBiQuery";
import { fmtDate } from "@/modules/bi/lib/format";
import { BiFilterBar, type BranchOption } from "@/modules/bi/components/BiFilterBar";
import { TopBarChart } from "@/modules/bi/components/TopBarChart";

type Segment = "CHAMPION" | "LOYAL" | "BIG_SPENDER" | "NEW" | "AT_RISK" | "LOST" | "REGULAR";

interface RfmRow {
    accountId: number; name: string; lastPurchase: string; daysAgo: number;
    bills: number; revenue: number; rScore: number; fScore: number; mScore: number; segment: Segment;
}
interface Report {
    branches: BranchOption[];
    summary: { segment: Segment; customers: number; revenue: number }[];
    rows: RfmRow[];
}

const SEGMENT_LABELS: Record<Segment, string> = {
    CHAMPION: "Champion", LOYAL: "Loyal", BIG_SPENDER: "Big Spender", NEW: "New / Promising",
    AT_RISK: "At Risk", LOST: "Lost", REGULAR: "Regular",
};
const SEGMENT_BADGES: Record<Segment, string> = {
    CHAMPION: "bg-emerald-500/15 text-emerald-600",
    LOYAL: "bg-sky-500/15 text-sky-600",
    BIG_SPENDER: "bg-violet-500/15 text-violet-600",
    NEW: "bg-teal-500/15 text-teal-600",
    AT_RISK: "bg-amber-500/15 text-amber-600",
    LOST: "bg-red-500/15 text-red-600",
    REGULAR: "bg-muted text-muted-foreground",
};
const SEGMENT_HINTS: Record<Segment, string> = {
    CHAMPION: "best customers — reward them",
    LOYAL: "buy often — keep engaged",
    BIG_SPENDER: "high value — personal attention",
    NEW: "recent first-timers — convert to repeat",
    AT_RISK: "used to buy often, gone quiet — win back",
    LOST: "long gone — low-cost re-activation only",
    REGULAR: "middle of the pack",
};

function defaultFrom(): string {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return toIsoDate(d);
}

export default function RfmPage() {
    const [from, setFrom] = useState(defaultFrom());
    const [to, setTo] = useState(toIsoDate(new Date()));
    const [branchId, setBranchId] = useState("");
    const [segFilter, setSegFilter] = useState<Segment | "ALL">("ALL");

    const { data, status, reload } = useBiQuery<Report>(
        `/api/bi/rfm?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ""}`,
    );

    const rows = useMemo(
        () => (data ? (segFilter === "ALL" ? data.rows : data.rows.filter((r) => r.segment === segFilter)) : []),
        [data, segFilter],
    );

    const chartData = useMemo(
        () => (data ? data.summary.filter((s) => s.customers > 0).map((s) => ({ name: SEGMENT_LABELS[s.segment], revenue: s.revenue })) : []),
        [data],
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">RFM Segmentation</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Recency · Frequency · Monetary — each scored 1–5 within your customer base (window default: last 12 months). Walk-in sales are excluded.
                    </p>
                </div>
                <BiFilterBar
                    from={from} to={to} branchId={branchId} branches={data?.branches ?? []}
                    onFrom={setFrom} onTo={setTo} onBranch={setBranchId} onRefresh={reload}
                />
            </div>

            {status}

            {data && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                        {data.summary.map((s) => (
                            <button
                                key={s.segment}
                                onClick={() => setSegFilter(segFilter === s.segment ? "ALL" : s.segment)}
                                title={SEGMENT_HINTS[s.segment]}
                                className={`rounded-lg border p-2.5 text-left shadow-sm transition-colors ${
                                    segFilter === s.segment ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/40"
                                }`}
                            >
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SEGMENT_BADGES[s.segment]}`}>
                                    {SEGMENT_LABELS[s.segment]}
                                </span>
                                <div className="mt-1 text-base font-mono font-semibold text-foreground">{s.customers}</div>
                                <div className="text-[10px] text-muted-foreground truncate">{fmt(s.revenue)}</div>
                            </button>
                        ))}
                    </div>

                    {chartData.length > 0 && (
                        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-medium text-foreground">Revenue by segment</div>
                            <TopBarChart data={chartData} dataKey="revenue" name="Revenue" height={Math.max(120, chartData.length * 32)} />
                        </div>
                    )}

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                                    <th className="px-3 py-2 text-left font-medium">Segment</th>
                                    <th className="px-3 py-2 text-right font-medium">Last Purchase</th>
                                    <th className="px-3 py-2 text-right font-medium">Days Ago</th>
                                    <th className="px-3 py-2 text-right font-medium">Bills</th>
                                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                                    <th className="px-3 py-2 text-right font-medium">R·F·M</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 ? (
                                    <tr><td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">No identified customers in this window.</td></tr>
                                ) : rows.map((r) => (
                                    <tr key={r.accountId} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-3 py-2.5 font-medium text-foreground">{r.name}</td>
                                        <td className="px-3 py-2.5">
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SEGMENT_BADGES[r.segment]}`}>
                                                {SEGMENT_LABELS[r.segment]}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{fmtDate(r.lastPurchase)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{r.daysAgo}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{r.bills}</td>
                                        <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmt(r.revenue)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{r.rScore}·{r.fScore}·{r.mScore}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
        </ScrollArea>
    );
}
