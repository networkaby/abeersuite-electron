"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { formatDateInput } from "@/modules/tally/lib/period";
import type { OutstandingsReport } from "@/modules/tally/lib/outstandings";

const BUCKET_LABELS = {
    b0_30:    "0–30 days",
    b30_60:   "30–60 days",
    b60_90:   "60–90 days",
    b90_plus: "90+ days",
} as const;

const BUCKET_COLORS = {
    b0_30:    "text-foreground",
    b30_60:   "text-amber-600",
    b60_90:   "text-orange-600",
    b90_plus: "text-red-600",
} as const;

export default function PayablesPage() {
    const router = useRouter();
    const [asOf, setAsOf] = useState(formatDateInput(new Date()));
    const [data, setData] = useState<OutstandingsReport | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios.get<OutstandingsReport>(`/api/finance/reports/payables?asOf=${asOf}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load payables"))
            .finally(() => setLoading(false));
    }, [asOf]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    return (
        <div className="max-w-7xl mx-auto space-y-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Payables</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Open bills to Sundry Creditors with ageing buckets — click a party to drill into bills.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>As on</Label>
                        <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-auto" />
                    </div>
                    <Button onClick={load}>Run</Button>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {(Object.keys(BUCKET_LABELS) as (keyof typeof BUCKET_LABELS)[]).map((k) => (
                            <div key={k} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                                <div className="text-xs text-muted-foreground">{BUCKET_LABELS[k]}</div>
                                <div className={`mt-1 text-lg font-mono font-semibold ${BUCKET_COLORS[k]}`}>
                                    {fmt(data.buckets[k])}
                                </div>
                            </div>
                        ))}
                        <div className="rounded-lg border border-border bg-primary/10 p-3 shadow-sm">
                            <div className="text-xs text-muted-foreground">Total Outstanding</div>
                            <div className="mt-1 text-lg font-mono font-bold text-primary">
                                {fmt(data.totalOutstanding)}
                            </div>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Party</th>
                                    <th className="px-3 py-2 text-right font-medium">Bills</th>
                                    <th className="px-3 py-2 text-right font-medium">0–30</th>
                                    <th className="px-3 py-2 text-right font-medium">30–60</th>
                                    <th className="px-3 py-2 text-right font-medium">60–90</th>
                                    <th className="px-3 py-2 text-right font-medium">90+</th>
                                    <th className="px-3 py-2 text-right font-medium">Total</th>
                                    <th className="px-3 py-2 w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {data.parties.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">
                                            No outstanding payables.
                                        </td>
                                    </tr>
                                ) : data.parties.map((p) => (
                                    <tr
                                        key={p.accountId}
                                        className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                        onClick={() => router.push(`/office/tally/reports/ledger-outstandings/${p.accountId}?asOf=${asOf}`)}
                                    >
                                        <td className="px-3 py-2.5 font-medium text-foreground">{p.accountName}</td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{p.billCount}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{p.buckets.b0_30 > 0 ? fmt(p.buckets.b0_30) : <span className="text-muted-foreground/40">—</span>}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-amber-600">{p.buckets.b30_60 > 0 ? fmt(p.buckets.b30_60) : <span className="text-muted-foreground/40">—</span>}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-orange-600">{p.buckets.b60_90 > 0 ? fmt(p.buckets.b60_90) : <span className="text-muted-foreground/40">—</span>}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-red-600">{p.buckets.b90_plus > 0 ? fmt(p.buckets.b90_plus) : <span className="text-muted-foreground/40">—</span>}</td>
                                        <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmt(p.totalOutstanding)}</td>
                                        <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight size={14} /></td>
                                    </tr>
                                ))}
                            </tbody>
                            {data.parties.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td className="px-3 py-2.5">Total</td>
                                        <td />
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.buckets.b0_30)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-amber-600">{fmt(data.buckets.b30_60)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-orange-600">{fmt(data.buckets.b60_90)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-red-600">{fmt(data.buckets.b90_plus)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totalOutstanding)}</td>
                                        <td />
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
