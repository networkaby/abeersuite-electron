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

type Bucket = { rate: number; taxableValue: number; taxAmount: number; grossValue: number; invoiceCount: number };
type Summary = { buckets: Bucket[]; totals: { taxableValue: number; taxAmount: number; grossValue: number; invoiceCount: number } };

export default function GstLiabilityPage() {
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(toIsoDate(fyStart));
    const [to, setTo]     = useState(toIsoDate(new Date()));
    const [outward, setOutward] = useState<Summary | null>(null);
    const [inward,  setInward]  = useState<Summary | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        Promise.all([
            axios.get<Summary>(`/api/accountancy/reports/gst-summary?from=${from}&to=${to}&direction=OUTWARD`).then((r) => r.data),
            axios.get<Summary>(`/api/accountancy/reports/gst-summary?from=${from}&to=${to}&direction=INWARD`).then((r) => r.data),
        ])
            .then(([o, i]) => { setOutward(o); setInward(i); })
            .catch(() => toast.error("Failed to load GST liability"))
            .finally(() => setLoading(false));
    }, [from, to]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    const outputTax = outward?.totals.taxAmount ?? 0;
    const inputTax  = inward?.totals.taxAmount ?? 0;
    const netLiability = outputTax - inputTax;

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-5xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Net GST Liability</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Output tax (collected on sales) minus Input tax (paid on purchases) — what&apos;s owed to the GST portal.
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
                    <Button onClick={load}>Refresh</Button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && outward && inward && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Stat label="Output Tax (Sales)"     value={fmt(outputTax)} tone="positive" />
                        <Stat label="Input Tax (Purchases)"  value={fmt(inputTax)} tone="negative" />
                        <Stat
                            label={netLiability >= 0 ? "Net Liability (payable)" : "Net Credit (refund / carry forward)"}
                            value={fmt(Math.abs(netLiability))}
                            bold
                            tone={netLiability >= 0 ? "negative" : "positive"}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <RatePanel title="Output Tax — by rate" data={outward} emptyText="No taxed sales in this period." />
                        <RatePanel title="Input Tax — by rate"  data={inward}  emptyText="No taxed purchases in this period." />
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

function RatePanel({ title, data, emptyText }: { title: string; data: Summary; emptyText: string }) {
    return (
        <div className="rounded-lg border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-2.5 flex items-center justify-between">
                <h2 className="font-semibold">{title}</h2>
                <span className="text-sm font-mono font-bold">{fmt(data.totals.taxAmount)}</span>
            </div>
            <table className="w-full text-sm">
                <thead className="bg-muted text-xs text-muted-foreground border-b border-border">
                    <tr>
                        <th className="px-3 py-1.5 text-left font-medium">Rate</th>
                        <th className="px-3 py-1.5 text-right font-medium">Taxable</th>
                        <th className="px-3 py-1.5 text-right font-medium">Tax</th>
                    </tr>
                </thead>
                <tbody>
                    {data.buckets.length === 0 ? (
                        <tr><td colSpan={3} className="py-8 text-center text-muted-foreground text-xs">{emptyText}</td></tr>
                    ) : data.buckets.map((b) => (
                        <tr key={b.rate} className="border-b last:border-0">
                            <td className="px-3 py-2 font-medium">{b.rate.toFixed(2)} %</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(b.taxableValue)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(b.taxAmount)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
