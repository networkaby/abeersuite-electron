"use client";

// Shared body for both Outward (Sales) and Inward (Purchase) GST summary
// pages — same shape, different filter direction.

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmt } from "@/shared/lib/format/moneyInr";
import { indianFiscalYearStart, formatDateInput } from "@/modules/accountancy/lib/period";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { moduleTableHeadStyle } from "@/shared/lib/format/moduleTheme";

export type GstBucket = {
    rate:         number;
    taxableValue: number;
    taxAmount:    number;
    grossValue:   number;
    invoiceCount: number;
};
export type GstSummaryData = {
    from: string; to: string;
    direction: "OUTWARD" | "INWARD";
    invType: "SALE" | "PURCHASE";
    buckets: GstBucket[];
    totals: { taxableValue: number; taxAmount: number; grossValue: number; invoiceCount: number };
};

export function GstSummaryView({
    title, subtitle, direction,
}: {
    title:     string;
    subtitle:  string;
    direction: "OUTWARD" | "INWARD";
}) {
    const fyStart = indianFiscalYearStart();
    const [from, setFrom] = useState(formatDateInput(fyStart));
    const [to, setTo]     = useState(formatDateInput(new Date()));
    const [data, setData] = useState<GstSummaryData | null>(null);
    const [loading, setLoading] = useState(false);

    /** `silent` keeps the summary on screen while it re-reads — a live update
     *  must not blank a report someone is reading. Refresh passes nothing. */
    const load = useCallback((silent = false) => {
        if (!silent) setLoading(true);
        axios.get<GstSummaryData>(`/api/accountancy/reports/gst-summary?from=${from}&to=${to}&direction=${direction}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error(`Failed to load ${title}`))
            .finally(() => setLoading(false));
    }, [from, to, direction, title]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);
    // Every GST-bearing voucher moves these totals.
    useRealtimeTopics(["ledger"], () => { load(true); });

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">{title}</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
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
                <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="border-b text-xs text-muted-foreground" style={moduleTableHeadStyle("accountancy")}>
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">Tax Rate</th>
                                <th className="px-3 py-2 text-right font-medium">Invoices</th>
                                <th className="px-3 py-2 text-right font-medium">Taxable Value</th>
                                <th className="px-3 py-2 text-right font-medium">Tax Amount</th>
                                <th className="px-3 py-2 text-right font-medium">Gross Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.buckets.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="py-12 text-center text-muted-foreground text-sm">
                                        No taxed {direction === "OUTWARD" ? "sales" : "purchases"} in this period.
                                    </td>
                                </tr>
                            ) : data.buckets.map((b) => (
                                <tr key={b.rate} className="border-b last:border-0 hover:bg-muted/40">
                                    <td className="px-3 py-2.5 font-medium">{b.rate.toFixed(2)} %</td>
                                    <td className="px-3 py-2.5 text-right text-muted-foreground">{b.invoiceCount}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(b.taxableValue)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(b.taxAmount)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmt(b.grossValue)}</td>
                                </tr>
                            ))}
                        </tbody>
                        {data.buckets.length > 0 && (
                            <tfoot className="border-t bg-muted/30 font-semibold">
                                <tr>
                                    <td className="px-3 py-2.5">Total</td>
                                    <td className="px-3 py-2.5 text-right">{data.totals.invoiceCount}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.taxableValue)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.taxAmount)}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.grossValue)}</td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            )}
        </div>
    );
}
