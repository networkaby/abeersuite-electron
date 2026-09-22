"use client";

// The Receivables and Payables screens are the same report read from opposite
// sides of the book — same ageing periods, same party/bill tabs, same search,
// same drill-down. So there is one screen here and each page just says which
// side it is. Anything added below shows up on both, which is the point.

import { useEffect, useState, useCallback, useMemo } from "react";
import { partyProfileHref } from "@/shared/lib/parties";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronRight, HandCoins, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { formatDateCompact } from "@/shared/lib/format/formatDate";
import { BUCKET_COLORS, BUCKET_KEYS, BUCKET_LABELS } from "@/modules/accountancy/lib/ageing";
import { BillLinkDialog, clearBillLinkCache, type SettleRequest } from "@/modules/accountancy/components/BillLinkDialog";
import { BillLinkStatus } from "@/modules/accountancy/components/BillLinkStatus";
import { ToLinkChip } from "@/modules/accountancy/components/ToLinkChip";
import GlVoucherDialog from "@/shared/components/GlVoucherDialog";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { LinkContextMenu, useLinkContextMenu } from "@/shared/components/LinkContextMenu";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import type { OutstandingsReport } from "@/modules/accountancy/lib/outstandings";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { referenceHref, voucherSourceForType } from "@/modules/accountancy/lib/voucherUrls";
import { moduleTableHeadStyle } from "@/shared/lib/format/moduleTheme";

// The period labels and colours live in `lib/ageing.ts` — this report and the
// party's own Outstanding tab in the customer profile share them.
type Bucket = keyof typeof BUCKET_LABELS;
type ViewMode = "party" | "bill";

const EMPTY_BUCKETS = { b0_30: 0, b30_60: 0, b60_90: 0, b90_plus: 0 };

export function OutstandingsReportScreen({
    title, subtitle, apiPath, loadError, emptyText, settleKind, settleHint,
}: {
    title:      string;
    subtitle:   string;
    /** `/api/accountancy/reports/receivables` or `…/payables`. */
    apiPath:    string;
    loadError:  string;
    /** Shown when the book itself is clear, before any search or period. */
    emptyText:  { party: string; bill: string };
    /** Which voucher settles a bill on this report: a receivable is received,
     *  a payable is paid. The bill is the starting point here, so the button
     *  opens that voucher itself — the form's own open-bills panel does the
     *  ticking, the party's existing credits included, which is everything the
     *  link popup used to do and more. */
    settleKind: SettleRequest["kind"];
    /** Tooltip on that button, worded in each side's own money's terms. */
    settleHint: string;
}) {
    const [asOf, setAsOf] = useState(toIsoDate(new Date()));
    // The receipt / payment being made against a bill, hosted right here so the
    // report stays on screen behind it.
    const [settle, setSettle] = useState<SettleRequest | null>(null);
    // The bill whose bill-wise links are being edited, if any. Carries its own
    // party with it — this report lists every party at once, so the popup cannot
    // read the party off the screen the way a profile tab can.
    const [link, setLink] = useState<{ accountId: number; name: string; voucherId: number } | null>(null);
    const { menu: linkMenu, close: closeLinkMenu, onContainerContextMenu: onLinkContextMenu } = useLinkContextMenu();
    const [data, setData] = useState<OutstandingsReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [view, setView] = useState<ViewMode>("party");
    const [query, setQuery] = useState("");
    // Clicking a period card shows that period alone; clicking it again clears.
    const [period, setPeriod] = useState<Bucket | null>(null);
    // Clicking a party row narrows this same page to that party's bills — held by
    // account id, not by name, so two look-alike names can never be confused.
    const [focus, setFocus] = useState<{ accountId: number; name: string } | null>(null);

    const load = useCallback((silent = false) => {
        // A realtime refresh must not blank a report the user is reading.
        if (!silent) setLoading(true);
        axios.get<OutstandingsReport>(`${apiPath}?asOf=${asOf}`)
            .then((r) => setData(r.data))
            .catch(() => toast.error(loadError))
            .finally(() => setLoading(false));
    }, [asOf, apiPath, loadError]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    // Every write that moves the books announces "ledger", so this covers a
    // voucher posted at another counter as well as one posted here.
    useRealtimeTopics(["ledger"], () => load(true));

    useEffect(() => {
        if (!focus) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFocus(null); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [focus]);

    // `searchKey` carries the party's name, GSTIN and phone numbers, and on
    // a bill row its reference number too. Searching and the period toggle only
    // narrow what is already on screen — no refetch, no extra DB read.
    const q = query.trim().toLowerCase();

    const parties = useMemo(() => {
        if (!data) return [];
        let rows = q ? data.parties.filter((p) => p.searchKey.includes(q)) : data.parties;
        // A party belongs to a period only if it has money sitting in it.
        if (period) rows = rows.filter((p) => p.buckets[period] > 0.005);
        return rows;
    }, [data, q, period]);

    // A bill row is drawn per bill, but "is there anything to link" is a question
    // about the PARTY. Read off the party rows already in hand — the bill-wise
    // tab must not ask the server a second time for what the same report carries.
    const toLinkByParty = useMemo(
        () => new Map((data?.parties ?? []).map((p) => [p.accountId, p.toLink])),
        [data],
    );

    // Party link — the customer explorer opens on the Person or Company behind
    // the ledger, the same URL the day book and the voucher reports use. A
    // creditor/debtor account with neither (a plain ledger head) stays text.
    const partyHrefByAccount = useMemo(
        () => new Map(
            (data?.parties ?? []).map((p) => [
                p.accountId,
                p.personId  != null ? partyProfileHref("person",  p.personId)
                    : p.companyId != null ? partyProfileHref("company", p.companyId)
                    : null,
            ] as const),
        ),
        [data],
    );

    const bills = useMemo(() => {
        if (!data) return [];
        let rows = q ? data.bills.filter((b) => b.searchKey.includes(q)) : data.bills;
        if (period) rows = rows.filter((b) => b.bucket === period);
        if (focus) rows = rows.filter((b) => b.accountId === focus.accountId);
        return rows;
    }, [data, q, period, focus]);

    // The cards on top always report the whole book — they are the buttons, so
    // their figures must not move. The row under a table adds up only the rows
    // that table is showing.
    const shownParty = useMemo(() => {
        if (!q && !period) return { buckets: data?.buckets ?? EMPTY_BUCKETS, total: data?.totalOutstanding ?? 0 };
        const buckets = { ...EMPTY_BUCKETS };
        let total = 0;
        for (const p of parties) {
            buckets.b0_30    += p.buckets.b0_30;
            buckets.b30_60   += p.buckets.b30_60;
            buckets.b60_90   += p.buckets.b60_90;
            buckets.b90_plus += p.buckets.b90_plus;
            // With a period on, the row's Total column shows that period alone, so
            // the footer must add up the same thing the eye is adding up.
            total += period ? p.buckets[period] : p.totalOutstanding;
        }
        return { buckets, total };
    }, [data, q, period, parties]);

    const shownBillTotal = useMemo(
        () => !q && !period && !focus ? (data?.totalOutstanding ?? 0) : bills.reduce((sum, b) => sum + b.outstanding, 0),
        [data, q, period, focus, bills],
    );

    // `referenceHref` is the one place that knows each kind's own edit page.
    const billHref = (b: { voucherType: string; id: number }) =>
        referenceHref(voucherSourceForType(b.voucherType), b.id, b.voucherType);

    const narrowed = (what: string) =>
        `No ${what} ${q ? `matches “${query.trim()}”` : "sits"}${period ? ` in ${BUCKET_LABELS[period]}` : ""}${focus ? ` for ${focus.name}` : ""}.`;

    const cardClass = (on: boolean) =>
        `rounded-lg border px-3 py-1.5 text-left shadow-sm transition-colors ${
            on ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-card hover:bg-muted/50"
        }`;

    const tabClass = (on: boolean) =>
        `px-4 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            on ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
        }`;

    return (
        <ScrollArea className="h-full" type="always">
        {/* Right-click on any link in the report — a party name, a bill ref —
            offers "Open in new window", the same menu the sidebar and the
            Quick Actions bar give. The desktop shell has no menu of its own. */}
        <div className="max-w-7xl mx-auto space-y-3 px-6 pt-2 pb-4" onContextMenu={onLinkContextMenu}>
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-xl font-bold text-foreground">{title}</h1>
                    <p className="text-xs text-muted-foreground">{subtitle}</p>
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
                    placeholder="Search party name, number, GSTIN or bill no…"
                    className="h-8 pl-8"
                />
            </div>

            {focus && (
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Showing</span>
                    <button
                        type="button"
                        onClick={() => setFocus(null)}
                        title="Show every party again (Esc)"
                        className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-3 py-0.5 font-medium text-primary hover:bg-primary/20"
                    >
                        {focus.name} <X size={13} />
                    </button>
                </div>
            )}

            {loading && (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-muted-foreground" size={28} />
                </div>
            )}

            {!loading && data && (
                <>
                    {/* Each card is the switch for its own period. */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {BUCKET_KEYS.map((k) => (
                            <button
                                key={k}
                                type="button"
                                title={period === k ? "Showing this period only — click to show all" : `Show only ${BUCKET_LABELS[k]}`}
                                onClick={() => setPeriod((cur) => (cur === k ? null : k))}
                                className={cardClass(period === k)}
                            >
                                <div className="text-xs text-muted-foreground">{BUCKET_LABELS[k]}</div>
                                <div className={`text-base font-mono font-semibold ${BUCKET_COLORS[k]}`}>
                                    {fmt(data.buckets[k])}
                                </div>
                            </button>
                        ))}
                        <button
                            type="button"
                            title="Show every period"
                            onClick={() => setPeriod(null)}
                            className={cardClass(period === null)}
                        >
                            <div className="text-xs text-muted-foreground">Total Outstanding</div>
                            <div className="text-base font-mono font-bold text-primary">
                                {fmt(data.totalOutstanding)}
                            </div>
                        </button>
                    </div>

                    {/* View tabs */}
                    <div className="flex items-center gap-1 border-b border-border">
                        <button onClick={() => setView("party")} className={tabClass(view === "party")}>
                            Party-wise <span className="ml-1 text-xs text-muted-foreground">({parties.length})</span>
                        </button>
                        <button onClick={() => setView("bill")} className={tabClass(view === "bill")}>
                            Bill-wise <span className="ml-1 text-xs text-muted-foreground">({bills.length})</span>
                        </button>
                    </div>

                    {view === "party" && (
                    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="border-b text-xs text-muted-foreground" style={moduleTableHeadStyle("accountancy")}>
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
                                            {q || period ? narrowed("party") : emptyText.party}
                                        </td>
                                    </tr>
                                ) : parties.map((p) => (
                                    <tr
                                        key={p.accountId}
                                        className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                        title="Show this party's bills"
                                        onClick={() => { setFocus({ accountId: p.accountId, name: p.accountName }); setView("bill"); }}
                                    >
                                        <td className="px-3 py-1.5 font-medium text-foreground">
                                            <span className="inline-flex items-center gap-2">
                                                {partyHrefByAccount.get(p.accountId) ? (
                                                    <Link
                                                        href={partyHrefByAccount.get(p.accountId)!}
                                                        className="text-primary hover:underline"
                                                        title="Open this party in Customers"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {p.accountName}
                                                    </Link>
                                                ) : p.accountName}
                                                <ToLinkChip toLink={p.toLink} />
                                            </span>
                                        </td>
                                        <td className="px-3 py-1.5 text-right text-muted-foreground">{p.billCount}</td>
                                        <td className="px-3 py-1.5 text-right font-mono">{p.buckets.b0_30 > 0 ? fmt(p.buckets.b0_30) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-amber-600">{p.buckets.b30_60 > 0 ? fmt(p.buckets.b30_60) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-orange-600">{p.buckets.b60_90 > 0 ? fmt(p.buckets.b60_90) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-red-600">{p.buckets.b90_plus > 0 ? fmt(p.buckets.b90_plus) : <span className="text-muted-foreground/65">—</span>}</td>
                                        <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmt(period ? p.buckets[period] : p.totalOutstanding)}</td>
                                        <td className="px-3 py-1.5 text-muted-foreground"><ChevronRight size={14} /></td>
                                    </tr>
                                ))}
                            </tbody>
                            {parties.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td className="px-3 py-1.5">Total</td>
                                        <td />
                                        <td className="px-3 py-1.5 text-right font-mono">{fmt(shownParty.buckets.b0_30)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-amber-600">{fmt(shownParty.buckets.b30_60)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-orange-600">{fmt(shownParty.buckets.b60_90)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-red-600">{fmt(shownParty.buckets.b90_plus)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono">{fmt(shownParty.total)}</td>
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
                            <thead className="border-b text-xs text-muted-foreground" style={moduleTableHeadStyle("accountancy")}>
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
                                        <td colSpan={10} className="py-10 text-center text-muted-foreground text-sm">
                                            {q || period || focus ? narrowed("bill") : emptyText.bill}
                                        </td>
                                    </tr>
                                ) : bills.map((b) => {
                                    return (
                                        <tr
                                            key={`${b.kind}-${b.id}`}
                                            className="border-b last:border-0 hover:bg-muted/40"
                                        >
                                            <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground text-xs">{formatDateCompact(b.billDate)}</td>
                                            <td className="px-3 py-1.5 font-mono text-xs">
                                                {billHref(b) ? (
                                                    <Link href={billHref(b)!} className="text-primary hover:underline">{b.ref}</Link>
                                                ) : b.ref}
                                            </td>
                                            <td
                                                className="px-3 py-1.5 font-medium text-foreground cursor-pointer"
                                                title="Show only this party"
                                                onClick={() => setFocus({ accountId: b.accountId, name: b.accountName })}
                                            >
                                                {partyHrefByAccount.get(b.accountId) ? (
                                                    <Link
                                                        href={partyHrefByAccount.get(b.accountId)!}
                                                        className="text-primary hover:underline"
                                                        title="Open this party in Customers"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {b.accountName}
                                                    </Link>
                                                ) : b.accountName}
                                            </td>
                                            <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground text-xs">{formatDateCompact(b.dueDate)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono">{fmt(b.totalAmount)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{b.paid > 0 ? fmt(b.paid) : <span className="text-muted-foreground/65">—</span>}</td>
                                            <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmt(b.outstanding)}</td>
                                            <td className="px-3 py-1.5 text-right">
                                                <BillLinkStatus
                                                    bill={b}
                                                    toLink={toLinkByParty.get(b.accountId) ?? 0}
                                                    onLink={(voucherId) => setLink({ accountId: b.accountId, name: b.accountName, voucherId })}
                                                />
                                            </td>
                                            <td className="px-3 py-1.5 text-right">
                                                {b.universalVoucherId != null && (
                                                    <button
                                                        type="button"
                                                        title={settleHint}
                                                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                                        onClick={(e) => {
                                                            // The row itself drills to the party — keep that off this button.
                                                            e.stopPropagation();
                                                            setSettle({
                                                                kind:           settleKind,
                                                                partyAccountId: b.accountId,
                                                                amount:         b.outstanding,
                                                                billId:         b.universalVoucherId!,
                                                            });
                                                        }}
                                                    >
                                                        <HandCoins size={14} />
                                                    </button>
                                                )}
                                            </td>
                                            <td className="px-3 py-1.5 text-muted-foreground"><ChevronRight size={14} /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            {bills.length > 0 && (
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td colSpan={6} className="px-3 py-1.5 text-right">Total</td>
                                        <td className="px-3 py-1.5 text-right font-mono">{fmt(shownBillTotal)}</td>
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
        {/* The voucher opens as a dialog over the report — the bill is the
            starting point here, and the form carries the open-bills panel that
            ticks this bill and any credit the party is already sitting on.
            Saved or abandoned, the report is read again: a settled bill must not
            still be sitting there, and its open-bill list is now stale. */}
        <GlVoucherDialog
            kind={settle?.kind ?? null}
            settleBill={settle}
            onClose={() => { setSettle(null); clearBillLinkCache(); load(true); }}
        />

        {/* Clicking a bill's Status opens the same bill-wise popup the customer's
            Transactions tab opens from its Settled / Partial / Due chip — ticks,
            part amounts, Auto and all. Saved, the report is read again: the bill
            may now be settled and must not still be sitting in the list. */}
        {link && (
            <BillLinkDialog
                open
                onOpenChange={(v) => { if (!v) setLink(null); }}
                accountId={link.accountId}
                partyName={link.name}
                voucherId={link.voucherId}
                onSaved={() => { clearBillLinkCache(); setLink(null); load(true); }}
            />
        )}
        <LinkContextMenu menu={linkMenu} onClose={closeLinkMenu} />
        </ScrollArea>
    );
}
