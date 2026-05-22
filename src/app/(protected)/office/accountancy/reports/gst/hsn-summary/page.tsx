"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";

type HsnBucket = {
    hsn:          string;
    taxRate:      number;
    taxableValue: number;
    taxAmount:    number;
    grossValue:   number;
    quantity:     number;
    sampleNames:  string[];
    invoiceCount: number;
};
type HsnData = {
    from: string; to: string;
    direction: "OUTWARD" | "INWARD";
    buckets: HsnBucket[];
    totals: { taxableValue: number; taxAmount: number; grossValue: number; quantity: number };
    noHsnCount: number;
};

export default function HsnSummaryPage() {
    const fyStart = indianFiscalYearStart();
    const [from, setFrom]           = useState(toIsoDate(fyStart));
    const [to, setTo]               = useState(toIsoDate(new Date()));
    const [direction, setDirection] = useState<"OUTWARD" | "INWARD">("OUTWARD");
    const [data, setData]           = useState<HsnData | null>(null);
    const [loading, setLoading]     = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<HsnData>(`/api/accountancy/reports/gst-hsn-summary?from=${from}&to=${to}&direction=${direction}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load HSN summary"))
            .finally(() => setLoading(false));
    }, [from, to, direction]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">HSN / SAC Summary</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Posted lines grouped by HSN code &times; tax rate — the table you copy into GSTR-1 § 12.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="flex rounded-md border border-border overflow-hidden text-xs font-semibold">
                        {(["OUTWARD", "INWARD"] as const).map((d) => (
                            <button
                                key={d}
                                type="button"
                                onClick={() => setDirection(d)}
                                className={`px-3 py-1.5 transition-colors ${
                                    direction === d
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-card text-muted-foreground hover:bg-muted"
                                }`}
                            >
                                {d === "OUTWARD" ? "Sales" : "Purchases"}
                            </button>
                        ))}
                    </div>
                    <div className="space-y-1">
                        <Label>From</Label>
                        <TallyDateInput value={from} onValueChange={setFrom} className="w-auto" />
                    </div>
                    <div className="space-y-1">
                        <Label>To</Label>
                        <TallyDateInput value={to} onValueChange={setTo} className="w-auto" />
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
                    {data.noHsnCount > 0 && (
                        <div className="rounded-lg border border-amber-300/40 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 flex items-start gap-2 text-sm">
                            <AlertTriangle size={16} className="shrink-0 text-amber-700 dark:text-amber-400 mt-0.5" />
                            <div className="text-amber-900 dark:text-amber-200">
                                <strong>{data.noHsnCount} invoice{data.noHsnCount === 1 ? "" : "s"}</strong> had lines without
                                an HSN code on the product master. They&apos;re grouped into <em>(no HSN)</em> below — open the
                                product and add the HSN code to clean this up.
                            </div>
                        </div>
                    )}

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">HSN / SAC</th>
                                    <th className="px-3 py-2 text-left font-medium">Sample items</th>
                                    <th className="px-3 py-2 text-right font-medium">Rate</th>
                                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                                    <th className="px-3 py-2 text-right font-medium">Invoices</th>
                                    <th className="px-3 py-2 text-right font-medium">Taxable</th>
                                    <th className="px-3 py-2 text-right font-medium">Tax</th>
                                    <th className="px-3 py-2 text-right font-medium">Gross</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.buckets.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">
                                            No taxed {direction === "OUTWARD" ? "sales" : "purchases"} in this period.
                                        </td>
                                    </tr>
                                ) : data.buckets.map((b, i) => (
                                    <tr key={i} className={`border-b last:border-0 hover:bg-muted/40 ${b.hsn === "(no HSN)" ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}`}>
                                        <td className="px-3 py-2.5 font-mono">{b.hsn}</td>
                                        <td className="px-3 py-2.5 text-muted-foreground text-xs truncate max-w-xs">
                                            {b.sampleNames.join(", ")}
                                            {b.sampleNames.length > 0 && b.invoiceCount > b.sampleNames.length && ` +${b.invoiceCount - b.sampleNames.length}`}
                                        </td>
                                        <td className="px-3 py-2.5 text-right">{b.taxRate.toFixed(2)} %</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{b.quantity.toFixed(b.quantity % 1 === 0 ? 0 : 3)}</td>
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
                                        <td className="px-3 py-2.5" colSpan={5}>Total</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.taxableValue)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.taxAmount)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totals.grossValue)}</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
