"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmt } from "@/utils/constants";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { useEscapeBack } from "@/shared/hooks/useEscapeBack";
import type { LedgerOutstanding, AgeingBucket } from "@/modules/accountancy/lib/outstandings";

const BUCKET_LABELS: Record<AgeingBucket, string> = {
    b0_30:    "0–30",
    b30_60:   "30–60",
    b60_90:   "60–90",
    b90_plus: "90+",
};

const BUCKET_COLORS: Record<AgeingBucket, string> = {
    b0_30:    "text-foreground",
    b30_60:   "text-amber-600",
    b60_90:   "text-orange-600",
    b90_plus: "text-red-600",
};

export default function LedgerOutstandingsPage({
    params,
}: {
    params: Promise<{ ledgerId: string }>;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { ledgerId } = use(params);
    const initialAsOf = searchParams.get("asOf") ?? toIsoDate(new Date());
    const [asOf, setAsOf] = useState(initialAsOf);
    const [data, setData] = useState<LedgerOutstanding | null>(null);
    const [loading, setLoading] = useState(false);

    useEscapeBack();

    const load = useCallback(() => {
        setLoading(true);
        axios.get<LedgerOutstanding>(`/api/accountancy/reports/ledger-outstandings/${ledgerId}?asOf=${asOf}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load ledger outstandings"))
            .finally(() => setLoading(false));
    }, [ledgerId, asOf]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    const billUrl = (kind: "invoice" | "voucher" | "sale" | "purchase", id: number): string => {
        switch (kind) {
            case "invoice":  return `/office/accountancy/invoices/${id}`;
            case "voucher":  return `/office/accountancy/journal-entries/${id}`;
            case "sale":     return `/vouchers/sales/new?voucherId=${id}`;
            case "purchase": return `/vouchers/purchases/new?voucherId=${id}`;
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-5">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2 -ml-2">
                        <ArrowLeft size={14} /> Back
                    </Button>
                    <h1 className="text-2xl font-bold text-foreground">
                        {data ? data.accountName : "Ledger"}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Open bills with ageing — drill into any bill to see the source document.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>As on</Label>
                        <TallyDateInput value={asOf} onValueChange={setAsOf} className="w-auto" />
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
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {(Object.keys(BUCKET_LABELS) as AgeingBucket[]).map((k) => (
                            <div key={k} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                                <div className="text-xs text-muted-foreground">{BUCKET_LABELS[k]} days</div>
                                <div className={`mt-1 text-lg font-mono font-semibold ${BUCKET_COLORS[k]}`}>
                                    {fmt(data.buckets[k])}
                                </div>
                            </div>
                        ))}
                        <div className="rounded-lg border border-border bg-primary/10 p-3 shadow-sm">
                            <div className="text-xs text-muted-foreground">Total</div>
                            <div className="mt-1 text-lg font-mono font-bold text-primary">
                                {fmt(data.totalOutstanding)}
                            </div>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Bill</th>
                                    <th className="px-3 py-2 text-left font-medium">Date</th>
                                    <th className="px-3 py-2 text-left font-medium">Due</th>
                                    <th className="px-3 py-2 text-right font-medium">Days</th>
                                    <th className="px-3 py-2 text-right font-medium">Total</th>
                                    <th className="px-3 py-2 text-right font-medium">Paid</th>
                                    <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.bills.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">
                                            No open bills for this ledger.
                                        </td>
                                    </tr>
                                ) : data.bills.map((b) => (
                                    <tr key={`${b.kind}-${b.id}`} className="border-b last:border-0 hover:bg-muted/40">
                                        <td className="px-3 py-2.5 font-mono">
                                            <Link
                                                href={billUrl(b.kind, b.id)}
                                                className="text-primary hover:underline"
                                            >
                                                {b.ref}
                                            </Link>
                                        </td>
                                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                                            {new Date(b.billDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                        </td>
                                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                                            {new Date(b.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                        </td>
                                        <td className={`px-3 py-2.5 text-right font-mono ${BUCKET_COLORS[b.bucket]}`}>{b.daysOverdue}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(b.totalAmount)}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{b.paid > 0 ? fmt(b.paid) : <span className="text-muted-foreground/40">—</span>}</td>
                                        <td className={`px-3 py-2.5 text-right font-mono font-semibold ${BUCKET_COLORS[b.bucket]}`}>{fmt(b.outstanding)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            {data.bills.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td colSpan={6} className="px-3 py-2.5">Total</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totalOutstanding)}</td>
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
