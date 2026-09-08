"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronRight, Link2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { BillLinkDialog } from "@/modules/accountancy/components/BillLinkDialog";
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

type ViewMode = "party" | "bill";

function fmtIsoDate(s: string): string {
    // Mon DD format; year omitted for compact rows
    const d = new Date(s);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

export default function ReceivablesPage() {
    const router = useRouter();
    const [asOf, setAsOf] = useState(toIsoDate(new Date()));
    // Which bill the link popup is settling, with the party it stands against.
    const [linkTarget, setLinkTarget] = useState<{ voucherId: number; accountId: number; accountName: string } | null>(null);
    const [data, setData] = useState<OutstandingsReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [view, setView] = useState<ViewMode>("party");
    const [query, setQuery] = useState("");

    const load = useCallback((silent = false) => {
        // A realtime refresh must not blank a report the user is reading.
        if (!silent) setLoading(true);
        axios.get<OutstandingsReport>(`/api/accountancy/reports/receivables?asOf=${asOf}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error("Failed to load receivables"))
            .finally(() => setLoading(false));
    }, [asOf]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    // Every write that moves the books announces "ledger", so this covers a
    // voucher posted at another counter as well as one posted here.
    useRealtimeTopics(["ledger"], () => load(true));

    // Search only narrows what is already on screen — no refetch, no extra DB read.
    // The bucket cards and the Total row stay on the full report figures.
    const q = query.trim().toLowerCase();
    const parties = useMemo(
        () => !data ? [] : !q ? data.parties : data.parties.filter((p) => p.accountName.toLowerCase().includes(q)),
        [data, q],
    );
    const bills = useMemo(
        () => !data ? [] : !q ? data.bills
            : data.bills.filter((b) => b.accountName.toLowerCase().includes(q) || b.ref.toLowerCase().includes(q)),
        [data, q],
    );

    return (
        <ScrollArea className="h-full" type="always">
        <div className="max-w-7xl mx-auto space-y-5 px-6 pt-3 pb-6">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Receivables</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Open bills from Sundry Debtors with ageing buckets — click a party to drill into bills.
                    </p>
                </div>
                <div className="flex items-end gap-2">
                    <div className="space-y-1">
                        <Label>Search</Label>
                        <div className="relative">
                            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Party name or bill ref…"
                                className="w-56 pl-8"
                            />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>As on</Label>
                        <TallyDateInput value={asOf} onValueChange={setAsOf} className="w-auto" />
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

                    {/* View tabs */}
                    <div className="flex items-center gap-1 border-b border-border">
                        <button
                            onClick={() => setView("party")}
                            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                                view === "party"
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            Party-wise
                        </button>
                        <button
                            onClick={() => setView("bill")}
                            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                                view === "bill"
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            Bill-wise <span className="ml-1 text-xs text-muted-foreground">({bills.length})</span>
                        </button>
                    </div>

                    {view === "party" && (
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
                                        <td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">
                                            {q ? `No party matches “${query.trim()}”.` : "No outstanding receivables."}
                                        </td>
                                    </tr>
                                ) : parties.map((p) => (
                                    <tr
                                        key={p.accountId}
                                        className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                        onClick={() => router.push(`/office/accountancy/reports/ledger-outstandings/${p.accountId}?asOf=${asOf}`)}
                                    >
                                        <td className="px-3 py-2.5 font-medium text-foreground">{p.accountName}</td>
                                        <td className="px-3 py-2.5 text-right text-muted-foreground">{p.billCount}</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{p.buckets.b0_30 > 0 ? fmt(p.buckets.b0_30) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-amber-600">{p.buckets.b30_60 > 0 ? fmt(p.buckets.b30_60) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-orange-600">{p.buckets.b60_90 > 0 ? fmt(p.buckets.b60_90) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-2.5 text-right font-mono text-red-600">{p.buckets.b90_plus > 0 ? fmt(p.buckets.b90_plus) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmt(p.totalOutstanding)}</td>
                                        <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight size={14} /></td>
                                    </tr>
                                ))}
                            </tbody>
                            {parties.length > 0 && (
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
                    )}

                    {view === "bill" && (
                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Bill date</th>
                                    <th className="px-3 py-2 text-left font-medium">Ref</th>
                                    <th className="px-3 py-2 text-left font-medium">Party</th>
                                    <th className="px-3 py-2 text-left font-medium">Due date</th>
                                    <th className="px-3 py-2 text-right font-medium">Total</th>
                                    <th className="px-3 py-2 text-right font-medium">Paid</th>
                                    <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                                    <th className="px-3 py-2 text-right font-medium">Status</th>
                                    <th className="px-3 py-2 w-8" />
                                    <th className="px-3 py-2 w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {bills.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="py-12 text-center text-muted-foreground text-sm">
                                            {q ? `No bill matches “${query.trim()}”.` : "No outstanding bills."}
                                        </td>
                                    </tr>
                                ) : bills.map((b) => {
                                    const statusClass =
                                        b.bucket === "b0_30"    ? "text-muted-foreground" :
                                        b.bucket === "b30_60"   ? "text-amber-600" :
                                        b.bucket === "b60_90"   ? "text-orange-600" :
                                                                  "text-red-600";
                                    const statusLabel = b.daysOverdue <= 30
                                        ? `Within ${30 - b.daysOverdue}d`
                                        : `Overdue ${b.daysOverdue - 30}d`;
                                    return (
                                        <tr
                                            key={`${b.kind}-${b.id}`}
                                            className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                            onClick={() => router.push(`/office/accountancy/reports/ledger-outstandings/${b.accountId}?asOf=${asOf}`)}
                                        >
                                            <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{fmtIsoDate(b.billDate)}</td>
                                            <td className="px-3 py-2.5 font-mono text-xs">{b.ref}</td>
                                            <td className="px-3 py-2.5 font-medium text-foreground">{b.accountName}</td>
                                            <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{fmtIsoDate(b.dueDate)}</td>
                                            <td className="px-3 py-2.5 text-right font-mono">{fmt(b.totalAmount)}</td>
                                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{b.paid > 0 ? fmt(b.paid) : <span className="text-muted-foreground/65">—</span>}</td>
                                            <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmt(b.outstanding)}</td>
                                            <td className={`px-3 py-2.5 text-right text-xs font-medium ${statusClass}`}>{statusLabel}</td>
                                            <td className="px-3 py-2.5 text-right">
                                                {b.universalVoucherId != null && (
                                                    <button
                                                        type="button"
                                                        title="Settle this bill against a receipt, credit note, purchase or journal of this party"
                                                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                                        onClick={(e) => {
                                                            // The row itself drills to the party — keep that off this button.
                                                            e.stopPropagation();
                                                            setLinkTarget({ voucherId: b.universalVoucherId!, accountId: b.accountId, accountName: b.accountName });
                                                        }}
                                                    >
                                                        <Link2 size={14} />
                                                    </button>
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5 text-muted-foreground"><ChevronRight size={14} /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            {bills.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td colSpan={6} className="px-3 py-2.5 text-right">Total</td>
                                        <td className="px-3 py-2.5 text-right font-mono">{fmt(data.totalOutstanding)}</td>
                                        <td colSpan={3} />
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                    )}
                </>
            )}
        </div>
        {linkTarget && (
            <BillLinkDialog
                open
                onOpenChange={(v) => { if (!v) setLinkTarget(null); }}
                accountId={linkTarget.accountId}
                partyName={linkTarget.accountName}
                voucherId={linkTarget.voucherId}
                onSaved={() => load(true)}
            />
        )}
        </ScrollArea>
    );
}
