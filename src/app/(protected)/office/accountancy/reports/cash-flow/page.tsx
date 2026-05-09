"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart, formatDateInput } from "@/modules/accountancy/lib/period";

type Flow = { id: number; name: string; amount: number };
type CashFlowData = {
    from: string; to: string;
    inflows: Flow[]; outflows: Flow[];
    totalIn: number; totalOut: number; netChange: number;
    openingCash: number; closingCash: number;
};

export default function CashFlowPage() {
    const router = useRouter();
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(formatDateInput(fyStart));
    const [to, setTo]     = useState(formatDateInput(new Date()));
    const [data, setData] = useState<CashFlowData | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<CashFlowData>(`/api/finance/reports/cash-flow?from=${from}&to=${to}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load cash flow"))
            .finally(() => setLoading(false));
    }, [from, to]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Cash Flow</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Cash &amp; bank movement through every counterparty ledger — in, out, net.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>From</Label>
                        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
                    </div>
                    <div className="space-y-1">
                        <Label>To</Label>
                        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
                    </div>
                    <Button onClick={load}>Refresh</Button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Stat label="Opening Cash" value={fmt(data.openingCash)} />
                        <Stat label="Total Inflow"  value={fmt(data.totalIn)}  positive />
                        <Stat label="Total Outflow" value={fmt(data.totalOut)} negative />
                        <Stat label="Closing Cash" value={fmt(data.closingCash)} bold />
                    </div>
                    <div className="rounded-lg border border-border bg-primary/5 px-4 py-2.5 flex justify-between items-center">
                        <span className="text-sm font-semibold">Net change in cash position</span>
                        <span className={`text-base font-mono font-bold ${data.netChange >= 0 ? "text-green-600" : "text-destructive"}`}>
                            {data.netChange >= 0 ? "+" : ""}{fmt(data.netChange)}
                        </span>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <FlowPanel
                            title="Inflows"
                            empty="No cash receipts in this period."
                            rows={data.inflows}
                            total={data.totalIn}
                            onRow={(id) => router.push(`/office/accountancy/account/${id}?from=${from}&to=${to}`)}
                            tone="positive"
                        />
                        <FlowPanel
                            title="Outflows"
                            empty="No cash payments in this period."
                            rows={data.outflows}
                            total={data.totalOut}
                            onRow={(id) => router.push(`/office/accountancy/account/${id}?from=${from}&to=${to}`)}
                            tone="negative"
                        />
                    </div>
                </>
            )}
        </div>
    );
}

function Stat({ label, value, positive, negative, bold }: { label: string; value: string; positive?: boolean; negative?: boolean; bold?: boolean }) {
    const tone = positive ? "text-green-600" : negative ? "text-destructive" : "text-foreground";
    return (
        <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`mt-1 text-lg font-mono ${bold ? "font-bold" : "font-semibold"} ${tone}`}>{value}</div>
        </div>
    );
}

function FlowPanel({
    title, rows, total, onRow, empty, tone,
}: {
    title: string;
    rows:  Flow[];
    total: number;
    onRow: (id: number) => void;
    empty: string;
    tone:  "positive" | "negative";
}) {
    const colour = tone === "positive" ? "text-green-600" : "text-destructive";
    return (
        <div className="rounded-lg border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
                <h2 className="font-semibold">{title}</h2>
                <span className={`text-sm font-mono font-bold ${colour}`}>{fmt(total)}</span>
            </div>
            <table className="w-full text-sm">
                <tbody>
                    {rows.length === 0 ? (
                        <tr><td className="py-8 text-center text-muted-foreground text-xs">{empty}</td></tr>
                    ) : rows.map((r) => (
                        <tr
                            key={r.id}
                            className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                            onClick={() => onRow(r.id)}
                        >
                            <td className="px-4 py-2 text-foreground">{r.name}</td>
                            <td className={`px-4 py-2 text-right font-mono ${colour}`}>{fmt(r.amount)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
