"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import type { OutstandingsReport } from "@/modules/accountancy/lib/outstandings";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";

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

const EMPTY_BUCKETS = { b0_30: 0, b30_60: 0, b60_90: 0, b90_plus: 0 };

export default function PayablesPage() {
    const router = useRouter();
    const [asOf, setAsOf] = useState(toIsoDate(new Date()));
    const [data, setData] = useState<OutstandingsReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState("");

    const load = useCallback((silent = false) => {
        // A realtime refresh must not blank a report the user is reading.
        if (!silent) setLoading(true);
        axios.get<OutstandingsReport>(`/api/accountancy/reports/payables?asOf=${asOf}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load payables"))
            .finally(() => setLoading(false));
    }, [asOf]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    // Every write that moves the books announces "ledger", so this covers a
    // voucher posted at another counter as well as one posted here.
    useRealtimeTopics(["ledger"], () => load(true));

    // `searchKey` carries the party's name, code, GSTIN and phone numbers. Searching
    // only narrows what is already on screen — no refetch, no extra DB read, and the
    // bucket cards plus the Total row stay on the full report figures.
    const q = query.trim().toLowerCase();
    const parties = useMemo(
        () => !data ? [] : !q ? data.parties : data.parties.filter((p) => p.searchKey.includes(q)),
        [data, q],
    );

    // The cards on top always report the whole book; the row under the table adds up
    // only the rows the table is showing, so a search reads as its own little total.
    const shown = useMemo(() => {
        if (!q) return { buckets: data?.buckets ?? EMPTY_BUCKETS, total: data?.totalOutstanding ?? 0 };
        const buckets = { ...EMPTY_BUCKETS };
        let total = 0;
        for (const p of parties) {
            buckets.b0_30 += p.buckets.b0_30;
            buckets.b30_60 += p.buckets.b30_60;
            buckets.b60_90 += p.buckets.b60_90;
            buckets.b90_plus += p.buckets.b90_plus;
            total += p.totalOutstanding;
        }
        return { buckets, total };
    }, [data, q, parties]);

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-3 px-6 pt-2 pb-4">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-xl font-bold text-foreground">Payables</h1>
                    <p className="text-xs text-muted-foreground">
                        Open bills to Sundry Creditors with ageing buckets — click a party to drill into bills.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>As on</Label>
                        <TallyDateInput value={asOf} onValueChange={setAsOf} className="w-auto" />
                    </div>
                    <Button onClick={() => load()}>Refresh</Button>
                </div>
            </div>

            <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search party name, number, GSTIN or code…"
                    className="h-8 pl-8"
                />
            </div>

            {loading && (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {(Object.keys(BUCKET_LABELS) as (keyof typeof BUCKET_LABELS)[]).map((k) => (
                            <div key={k} className="rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm">
                                <div className="text-xs text-muted-foreground">{BUCKET_LABELS[k]}</div>
                                <div className={`text-base font-mono font-semibold ${BUCKET_COLORS[k]}`}>
                                    {fmt(data.buckets[k])}
                                </div>
                            </div>
                        ))}
                        <div className="rounded-lg border border-border bg-primary/10 px-3 py-1.5 shadow-sm">
                            <div className="text-xs text-muted-foreground">Total Outstanding</div>
                            <div className="text-base font-mono font-bold text-primary">
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
                                {parties.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="py-10 text-center text-muted-foreground text-sm">
                                            {q ? `No party matches “${query.trim()}”.` : "No outstanding payables."}
                                        </td>
                                    </tr>
                                ) : parties.map((p) => (
                                    <tr
                                        key={p.accountId}
                                        className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                        onClick={() => router.push(`/office/accountancy/reports/ledger-outstandings/${p.accountId}?asOf=${asOf}`)}
                                    >
                                        <td className="px-3 py-1.5 font-medium text-foreground">{p.accountName}</td>
                                        <td className="px-3 py-1.5 text-right text-muted-foreground">{p.billCount}</td>
                                        <td className="px-3 py-1.5 text-right font-mono">{p.buckets.b0_30 > 0 ? fmt(p.buckets.b0_30) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-amber-600">{p.buckets.b30_60 > 0 ? fmt(p.buckets.b30_60) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-orange-600">{p.buckets.b60_90 > 0 ? fmt(p.buckets.b60_90) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-red-600">{p.buckets.b90_plus > 0 ? fmt(p.buckets.b90_plus) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmt(p.totalOutstanding)}</td>
                                        <td className="px-3 py-1.5 text-muted-foreground"><ChevronRight size={14} /></td>
                                    </tr>
                                ))}
                            </tbody>
                            {parties.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td className="px-3 py-1.5">Total</td>
                                        <td />
                                        <td className="px-3 py-1.5 text-right font-mono">{fmt(shown.buckets.b0_30)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-amber-600">{fmt(shown.buckets.b30_60)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-orange-600">{fmt(shown.buckets.b60_90)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-red-600">{fmt(shown.buckets.b90_plus)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono">{fmt(shown.total)}</td>
                                        <td />
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </>
            )}
        </div>
        </ScrollArea>
    );
}
