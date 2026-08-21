"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

type Movement = { label: string; amount: number };
type FundFlowData = {
    from: string; to: string;
    sources:      Movement[];
    applications: Movement[];
    totalSources:      number;
    totalApplications: number;
    workingCapital: { opening: number; closing: number; change: number };
};

export default function FundFlowPage() {
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(toIsoDate(fyStart));
    const [to, setTo]     = useState(toIsoDate(new Date()));
    const [data, setData] = useState<FundFlowData | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback((silent = false) => {
        // A realtime refresh must not blank a report the user is reading.
        if (!silent) setLoading(true);
        axios.get<FundFlowData>(`/api/accountancy/reports/fund-flow?from=${from}&to=${to}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load fund flow"))
            .finally(() => setLoading(false));
    }, [from, to]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    // Every write that moves the books announces "ledger", so this covers a
    // voucher posted at another counter as well as one posted here.
    useRealtimeTopics(["ledger"], () => load(true));

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-6xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Fund Flow</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Sources &amp; application of funds, and how working capital moved across the period.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>From</Label>
                        <TallyDateInput value={from} onValueChange={setFrom} className="w-auto" />
                    </div>
                    <div className="space-y-1">
                        <Label>To</Label>
                        <TallyDateInput value={to} onValueChange={setTo} monthMode="end" className="w-auto" />
                    </div>
                    <Button onClick={() => load()}>Refresh</Button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Stat label="Opening Working Capital" value={fmt(data.workingCapital.opening)} />
                        <Stat label="Closing Working Capital" value={fmt(data.workingCapital.closing)} bold />
                        <Stat
                            label="Change in Working Capital"
                            value={`${data.workingCapital.change >= 0 ? "+" : ""}${fmt(data.workingCapital.change)}`}
                            tone={data.workingCapital.change >= 0 ? "positive" : "negative"}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <MovementPanel
                            title="Sources of Funds"
                            empty="No sources of funds in this period."
                            rows={data.sources}
                            total={data.totalSources}
                        />
                        <MovementPanel
                            title="Application of Funds"
                            empty="No application of funds in this period."
                            rows={data.applications}
                            total={data.totalApplications}
                        />
                    </div>
                </>
            )}
        </div>
        </ScrollArea>
    );
}

function Stat({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "positive" | "negative" }) {
    const colour = tone === "positive" ? "text-green-600" : tone === "negative" ? "text-destructive" : "text-foreground";
    return (
        <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`mt-1 text-lg font-mono ${bold ? "font-bold" : "font-semibold"} ${colour}`}>{value}</div>
        </div>
    );
}

function MovementPanel({
    title, rows, total, empty,
}: {
    title: string;
    rows:  Movement[];
    total: number;
    empty: string;
}) {
    return (
        <div className="rounded-lg border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
                <h2 className="font-semibold">{title}</h2>
                <span className="text-sm font-mono font-bold">{fmt(total)}</span>
            </div>
            <table className="w-full text-sm">
                <tbody>
                    {rows.length === 0 ? (
                        <tr><td className="py-8 text-center text-muted-foreground text-xs">{empty}</td></tr>
                    ) : rows.map((r) => (
                        <tr key={r.label} className="border-b last:border-0">
                            <td className="px-4 py-2 text-foreground">{r.label}</td>
                            <td className="px-4 py-2 text-right font-mono">{fmt(r.amount)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
