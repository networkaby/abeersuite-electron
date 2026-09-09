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
// and our supplier at once shows each side's bills here; the Settle button
// follows the bill, receiving on a sale and paying on a purchase.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { HandCoins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/utils/constants";
import { formatDateCompact } from "@/shared/lib/format/formatDate";
import { extractApiError } from "@/shared/lib/api";
import { BUCKET_COLORS, BUCKET_KEYS, BUCKET_LABELS, ageingStatusClass, ageingStatusLabel } from "@/modules/accountancy/lib/ageing";
import { BillLinkDialog, clearBillLinkCache, type SettleRequest } from "@/modules/accountancy/components/BillLinkDialog";
import GlVoucherDialog from "@/shared/components/GlVoucherDialog";
import { referenceHref, voucherSourceForType } from "@/modules/accountancy/lib/voucherUrls";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import type { LedgerOutstanding } from "@/modules/accountancy/lib/outstandings";

// A profile screen is tabbed, and a customer's open bills barely move between
// two clicks — so leaving the tab and coming back shows the last answer at once
// and only re-reads when it has gone stale. Every settle clears this, and the
// `ledger` topic refreshes it quietly when money moves anywhere else.
const TTL_MS = 60_000;
const cache = new Map<number, { at: number; data: LedgerOutstanding }>();

/** Drop a party's cached bills — after anything that settles one of them. */
function clearPartyCache(accountId: number): void {
    cache.delete(accountId);
}

export function PartyOutstandingsPanel({ accountId, partyName }: {
    /** The party ledger whose bills these are. */
    accountId: number;
    partyName: string;
}) {
    const [data, setData] = useState<LedgerOutstanding | null>(() => cache.get(accountId)?.data ?? null);
    const [loading, setLoading] = useState(false);
    // Which bill the link popup is settling.
    const [linkTarget, setLinkTarget] = useState<{ voucherId: number; billRef: string } | null>(null);
    // The receipt / payment being made, hosted here so the customer stays open
    // behind it — settling must not throw the user off the party they opened.
    const [settle, setSettle] = useState<SettleRequest | null>(null);

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

    const bills = data?.bills ?? [];

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 size={20} className="animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {BUCKET_KEYS.map((k) => (
                    <div key={k} className="rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm">
                        <div className="text-xs text-muted-foreground">{BUCKET_LABELS[k]}</div>
                        <div className={`font-mono text-base font-semibold ${BUCKET_COLORS[k]}`}>
                            {fmt(data?.buckets[k] ?? 0)}
                        </div>
                    </div>
                ))}
                <div className="rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm">
                    <div className="text-xs text-muted-foreground">Total Outstanding</div>
                    <div className="font-mono text-base font-bold text-primary">
                        {fmt(data?.totalOutstanding ?? 0)}
                    </div>
                </div>
            </div>

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
                            const statusClass = ageingStatusClass(b.bucket);
                            return (
                                <tr key={`${b.kind}-${b.id}`} className="border-b last:border-0 hover:bg-muted/40">
                                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{formatDateCompact(b.billDate)}</td>
                                    <td className="px-3 py-1.5 font-mono text-xs">
                                        {href ? <Link href={href} className="text-primary hover:underline">{b.ref}</Link> : b.ref}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{formatDateCompact(b.dueDate)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono">{fmt(b.totalAmount)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                        {b.paid > 0 ? fmt(b.paid) : <span className="text-muted-foreground/65">—</span>}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmt(b.outstanding)}</td>
                                    <td className={`px-3 py-1.5 text-right text-xs font-medium ${statusClass}`}>
                                        {ageingStatusLabel(b.daysOverdue)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right">
                                        {b.universalVoucherId != null && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                title="Settle this bill — against a receipt, note or journal of this party, or by taking the money now"
                                                onClick={() => setLinkTarget({ voucherId: b.universalVoucherId!, billRef: b.ref })}
                                            >
                                                <HandCoins size={14} className="mr-1" /> Settle
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {bills.length > 0 && (
                        <tfoot className="border-t bg-muted/30 font-semibold">
                            <tr>
                                <td colSpan={5} className="px-3 py-1.5 text-right">Total</td>
                                <td className="px-3 py-1.5 text-right font-mono">{fmt(data?.totalOutstanding ?? 0)}</td>
                                <td colSpan={2} />
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {/* `settleDirectly` — the bill is the starting point here, so a party
                with nothing open on the other side needs no popup: it goes
                straight to the receipt / payment. `onSettle` keeps that voucher
                on this page, as a dialog over the customer. */}
            {linkTarget && (
                <BillLinkDialog
                    open
                    onOpenChange={(v) => { if (!v) setLinkTarget(null); }}
                    accountId={accountId}
                    partyName={partyName}
                    voucherId={linkTarget.voucherId}
                    onSaved={() => { clearPartyCache(accountId); load(true); }}
                    settleDirectly
                    onSettle={setSettle}
                />
            )}
            {/* Saved or abandoned, the bills are read again: a settled bill must
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
                }}
            />
        </div>
    );
}
