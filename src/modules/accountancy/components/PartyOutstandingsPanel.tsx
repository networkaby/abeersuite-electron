"use client";

// One party's open bills, with a way to settle each of them — the Outstanding
// tab inside a customer / company profile.
//
// It is the Receivables report read for one ledger: same engine, same ageing
// periods, same settle path. What it is NOT is that report filtered in the
// browser — a profile screen asks for its own party only, so opening a customer
// never drags the whole book down.
//
// `getLedgerOutstanding` reads BOTH directions, so a party who is our customer
// and our supplier at once shows each side's bills here. That is the one thing
// this screen must ask the bill about and the group reports need not: which
// voucher settles it. The bill's own `side` answers — they owe us, so receive;
// we owe them, so pay.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, HandCoins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/shared/lib/format/moneyInr";
import { formatDateCompact } from "@/shared/lib/format/formatDate";
import { extractApiError } from "@/shared/lib/api";
import { BUCKET_COLORS, BUCKET_KEYS, BUCKET_LABELS } from "@/modules/accountancy/lib/ageing";
import { BillLinkDialog, clearBillLinkCache, type SettleRequest } from "@/modules/accountancy/components/BillLinkDialog";
import { BillLinkStatus } from "@/modules/accountancy/components/BillLinkStatus";
import { ToLinkChip } from "@/modules/accountancy/components/ToLinkChip";
import GlVoucherDialog from "@/shared/components/GlVoucherDialog";
import { referenceHref, voucherSourceForType } from "@/modules/accountancy/lib/voucherUrls";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import type { AgeingBucket, Buckets, LedgerOutstanding, OutstandingBill } from "@/modules/accountancy/lib/outstandings";

/** The two sides a party's bills can sit on, each with its own ageing.
 *  Reading them together would add money owed TO us to money owed BY us and
 *  call the answer a total, which is nothing at all. */
type SideSummary = { buckets: Buckets; total: number };

function summariseBySide(bills: OutstandingBill[]): { receivable: SideSummary; payable: SideSummary } {
    const blank = (): SideSummary => ({
        buckets: { b0_30: 0, b30_60: 0, b60_90: 0, b90_plus: 0 },
        total:   0,
    });
    const receivable = blank();
    const payable    = blank();
    for (const b of bills) {
        const side = b.side === 1 ? receivable : payable;
        side.buckets[b.bucket as AgeingBucket] += b.outstanding;
        side.total                             += b.outstanding;
    }
    return { receivable, payable };
}

// A profile screen is tabbed, and a customer's open bills barely move between
// two clicks — so leaving the tab and coming back shows the last answer at once
// and only re-reads when it has gone stale. Every settle clears this, and the
// `ledger` topic refreshes it quietly when money moves anywhere else.
const TTL_MS = 60_000;
const cache = new Map<number, { at: number; data: LedgerOutstanding }>();

/** Drop a party's cached bills — after anything that settles one of them.
 *
 *  Exported because the settling does not always happen on this panel: the
 *  Transactions tab beside it links from its own chip, and this panel is not even
 *  mounted then. Without this it would remount straight onto a cache entry that
 *  predates the link and show the bill still open, for up to the TTL above. */
export function clearPartyCache(accountId: number): void {
    cache.delete(accountId);
}

export function PartyOutstandingsPanel({ accountId, partyName, onChanged }: {
    /** The party ledger whose bills these are. */
    accountId: number;
    partyName: string;
    /** Called after anything here changes the party's books — a link saved, a
     *  receipt or payment made.
     *
     *  The realtime channel cannot carry this one: a broadcast never echoes to
     *  the window that sent it (`appChannel.ts` — "the acting tab is untouched,
     *  it already knows, and updates through its own save path"). This IS that
     *  save path. Every OTHER window hears the write through the axios publisher,
     *  which maps `/api/accountancy/` to `ledger`; only the one doing the saving
     *  has to be told in process, and without this its sibling tabs — the party's
     *  Transactions statement above all — keep showing settlement chips from
     *  before the link. */
    onChanged?: () => void;
}) {
    const [data, setData] = useState<LedgerOutstanding | null>(() => cache.get(accountId)?.data ?? null);
    const [loading, setLoading] = useState(false);
    // The receipt / payment being made, hosted here so the customer stays open
    // behind it — settling must not throw the user off the party they opened.
    const [settle, setSettle] = useState<SettleRequest | null>(null);
    // The bill whose bill-wise links are being edited — its spine id alone is
    // enough here, the party is this panel's own.
    const [linkBillId, setLinkBillId] = useState<number | null>(null);

    const load = useCallback((silent = false) => {
        if (!silent) setLoading(true);
        axios.get<LedgerOutstanding>(`/api/accountancy/outstandings/${accountId}`)
            .then((r) => {
                cache.set(accountId, { at: Date.now(), data: r.data });
                setData(r.data);
            })
            .catch((e) => toast.error(extractApiError(e, "Could not load this party's outstanding bills")))
            .finally(() => setLoading(false));
    }, [accountId]);

    useEffect(() => {
        const hit = cache.get(accountId);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setData(hit?.data ?? null);
        if (hit && Date.now() - hit.at < TTL_MS) return;
        load(hit != null);
    }, [accountId, load]);

    // Every write that moves the books announces "ledger" — a receipt posted at
    // another counter clears a bill on this screen without an F5.
    useRealtimeTopics(["ledger"], () => load(true));

    const bills = useMemo(() => data?.bills ?? [], [data]);
    const { receivable, payable } = useMemo(() => summariseBySide(bills), [bills]);
    const toLink = data?.toLink ?? 0;
    // A party with money on one side only — nearly all of them — shows one row
    // of cards. Show the receivable row when there is nothing at all, so the tab
    // opens with its shape rather than a bare table.
    const sides: { label: string; summary: SideSummary }[] = [
        ...(receivable.total > 0.005 || payable.total <= 0.005
            ? [{ label: "Total Receivable", summary: receivable }] : []),
        ...(payable.total > 0.005 ? [{ label: "Total Payable", summary: payable }] : []),
    ];

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 size={20} className="animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* One line, before any figure: is there linking work on this party at
                all. Without it the only way to find out is to open each bill's
                Status in turn and read "nothing open on the other side". */}
            {toLink > 0.005 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ToLinkChip toLink={toLink} />
                    <span>received or paid against no bill — open a Status below to place it.</span>
                </div>
            ) : bills.length > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 size={14} />
                    <span>Fully linked — nothing pending to settle bill-wise.</span>
                </div>
            )}

            {sides.map(({ label, summary }) => (
                <div key={label} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {BUCKET_KEYS.map((k) => (
                        <div key={k} className="rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm">
                            <div className="text-xs text-muted-foreground">{BUCKET_LABELS[k]}</div>
                            <div className={`font-mono text-base font-semibold ${BUCKET_COLORS[k]}`}>
                                {fmt(summary.buckets[k])}
                            </div>
                        </div>
                    ))}
                    <div className="rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm">
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="font-mono text-base font-bold text-primary">{fmt(summary.total)}</div>
                    </div>
                </div>
            ))}

            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                <table className="w-full text-sm">
                    <thead className="border-b bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Bill date</th>
                            <th className="px-3 py-2 text-left font-medium">Ref</th>
                            <th className="px-3 py-2 text-left font-medium">Due date</th>
                            <th className="px-3 py-2 text-right font-medium">Total</th>
                            <th className="px-3 py-2 text-right font-medium">Paid</th>
                            <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                            <th className="px-3 py-2 text-right font-medium">Status</th>
                            <th className="w-24 px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {bills.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                                    Nothing outstanding for {partyName} — every bill is settled.
                                </td>
                            </tr>
                        ) : bills.map((b) => {
                            const href = referenceHref(voucherSourceForType(b.voucherType), b.id, b.voucherType);
                            // Which way this bill's money runs is the bill's to
                            // say — both sides sit in one list here.
                            const owedToUs = b.side === 1;
                            return (
                                <tr key={`${b.kind}-${b.id}`} className="border-b last:border-0 hover:bg-muted/40">
                                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{formatDateCompact(b.billDate)}</td>
                                    <td className="px-3 py-1.5 font-mono text-xs">
                                        {href ? <Link href={href} className="text-primary hover:underline">{b.ref}</Link> : b.ref}
                                        <span className="ml-2 font-sans text-muted-foreground">{b.voucherType.replace(/_/g, " ").toLowerCase()}</span>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{formatDateCompact(b.dueDate)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono">{fmt(b.totalAmount)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                        {b.paid > 0 ? fmt(b.paid) : <span className="text-muted-foreground/65">—</span>}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmt(b.outstanding)}</td>
                                    <td className="px-3 py-1.5 text-right">
                                        <BillLinkStatus bill={b} toLink={toLink} onLink={setLinkBillId} />
                                    </td>
                                    <td className="px-3 py-1.5 text-right">
                                        {b.universalVoucherId != null && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                title={owedToUs
                                                    ? "Receive against this bill — opens a receipt with it already ticked"
                                                    : "Pay against this bill — opens a payment with it already ticked"}
                                                onClick={() => setSettle({
                                                    kind:           owedToUs ? "RECEIPT" : "PAYMENT",
                                                    partyAccountId: accountId,
                                                    amount:         b.outstanding,
                                                    billId:         b.universalVoucherId!,
                                                })}
                                            >
                                                <HandCoins size={14} className="mr-1" /> {owedToUs ? "Receive" : "Pay"}
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {/* No footer total: the two sides sit in one list here, and a
                        column that added them up would be money owed TO us plus
                        money owed BY us. Each side's own total is on its cards. */}
                </table>
            </div>

            {/* The receipt / payment form carries the open-bills panel itself —
                this bill ticked, every other open item of the party listed, and
                the party's existing credits ready to settle from. So the button
                opens that voucher straight away, as a dialog over the customer.
                Saved or abandoned, the bills are read again: a settled bill must
                not still be sitting there, and the open-bill lists both this
                panel and the link popup hold are now stale. */}
            <GlVoucherDialog
                kind={settle?.kind ?? null}
                settleBill={settle}
                onClose={() => {
                    setSettle(null);
                    clearBillLinkCache();
                    clearPartyCache(accountId);
                    load(true);
                    onChanged?.();
                }}
            />

            {/* Clicking a bill's Status opens the bill-wise popup for that bill —
                the same one the Transactions tab opens from its chip. Saved, the
                bills are read again: this one may now be settled. */}
            {linkBillId !== null && (
                <BillLinkDialog
                    open
                    onOpenChange={(v) => { if (!v) setLinkBillId(null); }}
                    accountId={accountId}
                    partyName={partyName}
                    voucherId={linkBillId}
                    onSaved={() => {
                        clearBillLinkCache();
                        clearPartyCache(accountId);
                        setLinkBillId(null);
                        load(true);
                        onChanged?.();
                    }}
                />
            )}
        </div>
    );
}
