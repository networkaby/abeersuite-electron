"use client";

// Bill-wise tick-list beside a Receipt / Payment form — "what does this party
// have open, and which of it is this money for?" — shown the moment a party is
// picked, BEFORE save.
//
// Two ways round, and the panel works out which from the row amount:
//   • amount already typed (say 5,000) → ticking fills bills WITHIN it: a 4,000
//     bill in full, then 1,000 of the next; once the money runs out a further
//     tick is refused.
//   • amount empty → each tick ADDS the bill's open amount to the row (4,000,
//     then 7,000), and unticking takes it back out.
// The ticks are handed up as a plan, so the link popup after posting opens
// already ticked the same way. The link itself still happens there: a link is
// only legal between two posted vouchers.

import { useEffect, useState } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { fmt } from "@/utils/constants";
import { extractApiError } from "@/shared/lib/api";
import { round2 } from "@/shared/lib/format/moneyInr";
import { EPS, type LinkableDoc } from "@/modules/accountancy/lib/billLinkPlan";

/** Ticked bills → amount placed on each (spine id → ₹). */
export type BillPicks = Record<number, number>;

// Same idea as the popup's cache: the party's open bills barely move between
// two keystrokes, and a spinner where a table just was reads as a bug.
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; docs: LinkableDoc[] }>();
// One request per key at a time — React runs the effect more than once around
// a pick (strict mode, re-renders), and each run must not be its own fetch.
const inflight = new Map<string, Promise<LinkableDoc[]>>();

/** Drop the cached open-bill lists — call after anything that changes them. */
export function clearOpenBillsCache(): void {
    cache.clear();
}

function fetchOpenBills(key: string, accountId: number, side: 1 | -1): Promise<LinkableDoc[]> {
    const running = inflight.get(key);
    if (running) return running;
    const p = axios.get<{ docs: LinkableDoc[] }>(`/api/accountancy/allocations/open?accountId=${accountId}&side=${side}`)
        .then((r) => {
            cache.set(key, { at: Date.now(), docs: r.data.docs });
            return r.data.docs;
        })
        .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
}

const sumOf = (picks: BillPicks) => round2(Object.values(picks).reduce((s, n) => s + n, 0));

export function OpenBillsPanel({ accountId, partyName, side, amount, picks, onChange, ledgerLabel, ledgerOwed }: {
    /** The party ledger whose open bills are shown. */
    accountId:  number;
    partyName?: string;
    /** +1 = bills they owe us (a Receipt settles these) · −1 = bills we owe (a Payment). */
    side:       1 | -1;
    /** The party row's amount as it stands. */
    amount:     number;
    /** Current ticks (owned by the form so they survive to the popup). */
    picks:      BillPicks;
    /** New ticks, and the row amount they imply (null = leave the amount alone). */
    onChange:   (picks: BillPicks, amount: number | null) => void;
    /** The ledger's own balance — "41,496.95 Cr" — and how much of it is owed on
     *  THIS side (positive = they owe us for a Receipt / we owe them for a Payment).
     *  Shown against the bill-wise open so a mismatch is explained, not hidden. */
    ledgerLabel?: string;
    ledgerOwed?:  number;
}) {
    const key = `${accountId}|${side}`;
    // The answer is keyed by the party, so switching party never shows the old
    // party's bills: an answer for another key is simply not this one.
    const [result, setResult] = useState<{ key: string; docs?: LinkableDoc[]; error?: string } | null>(null);
    // The last amount THIS panel set. While the row still shows it, the ticks
    // drive the amount; the moment it differs, the user typed and the amount
    // drives the ticks.
    const [setByTicks, setSetByTicks] = useState<number | null>(null);

    useEffect(() => {
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < TTL_MS) return;
        let cancelled = false;
        fetchOpenBills(key, accountId, side)
            .then((docs) => { if (!cancelled) setResult({ key, docs }); })
            .catch((e) => { if (!cancelled) setResult({ key, error: extractApiError(e, "Could not load open bills") }); });
        return () => { cancelled = true; };
    }, [accountId, side, key]);

    // Fresh answer for this key wins; otherwise a cached one (even if stale, while
    // the refresh is on its way); otherwise loading.
    const current = result?.key === key ? result : null;
    const docs: LinkableDoc[] | null = current?.docs ?? cache.get(key)?.docs ?? null;
    const error = current?.error ?? null;

    const totalOpen = (docs ?? []).reduce((s, d) => s + d.open, 0);
    // Ledger minus bills = the on-account part. Signed on this side: positive
    // = still owed beyond the bills, negative = advance already lying with us.
    const onAccount = ledgerOwed != null ? round2(ledgerOwed - totalOpen) : null;
    const placed = sumOf(picks);
    const amountTyped = amount > EPS && Math.abs(amount - (setByTicks ?? -1)) > EPS;

    const toggle = (d: LinkableDoc) => {
        const id = d.universalVoucherId;
        if (picks[id] !== undefined) {
            const next = { ...picks };
            delete next[id];
            const nextAmount = amountTyped ? null : sumOf(next);
            if (nextAmount !== null) setSetByTicks(nextAmount);
            onChange(next, nextAmount);
            return;
        }
        if (amountTyped) {
            // Fill within the typed amount — full where it fits, the rest partially.
            const room = round2(amount - placed);
            if (room <= EPS) {
                toast.info(`₹ ${fmt(amount)} is already placed — raise the amount to tick more.`);
                return;
            }
            onChange({ ...picks, [id]: round2(Math.min(room, d.open)) }, null);
            return;
        }
        // Amount empty (or set by earlier ticks) — each tick adds its bill.
        const next = { ...picks, [id]: d.open };
        const nextAmount = sumOf(next);
        setSetByTicks(nextAmount);
        onChange(next, nextAmount);
    };

    return (
        <div className="rounded-md border border-border bg-card p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Open bills{partyName ? ` — ${partyName}` : ""}
            </p>
            {error ? (
                <p className="mt-2 text-xs text-destructive">{error}</p>
            ) : docs === null ? (
                <div className="flex justify-center py-4">
                    <Loader2 className="animate-spin text-muted-foreground" size={16} />
                </div>
            ) : docs.length === 0 && !(onAccount != null && Math.abs(onAccount) > EPS) ? (
                <p className="mt-2 text-xs text-muted-foreground">
                    Nothing open. This {side === 1 ? "receipt" : "payment"} stays as an advance.
                </p>
            ) : (
                <>
                    <table className="mt-2 w-full text-xs">
                        <thead>
                            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                <th className="w-6" />
                                <th className="py-1 text-left font-medium">Bill</th>
                                <th className="py-1 text-right font-medium">Total</th>
                                <th className="py-1 text-right font-medium">Settled</th>
                                <th className="py-1 text-right font-medium">Open</th>
                            </tr>
                        </thead>
                        <tbody>
                            {docs.map((d) => {
                                const value = picks[d.universalVoucherId];
                                const ticked = value !== undefined;
                                const partial = ticked && value < d.open - EPS;
                                return (
                                    <tr
                                        key={d.universalVoucherId}
                                        className={`cursor-pointer border-t border-border/50 ${ticked ? "bg-primary/5" : "hover:bg-muted/50"}`}
                                        onClick={() => toggle(d)}
                                    >
                                        <td className="w-6 py-1">
                                            <Checkbox checked={ticked} onCheckedChange={() => toggle(d)} onClick={(e) => e.stopPropagation()} />
                                        </td>
                                        <td className="py-1 pr-1">
                                            <span className="font-mono whitespace-nowrap">{d.ref}</span>
                                            <span className="block text-[10px] text-muted-foreground">
                                                {new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                            </span>
                                        </td>
                                        <td className="py-1 pl-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">{fmt(d.face)}</td>
                                        <td className="py-1 pl-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">{fmt(round2(d.face - d.open))}</td>
                                        <td className="py-1 pl-2 text-right font-mono tabular-nums whitespace-nowrap">
                                            {ticked ? (
                                                <span className={partial ? "text-amber-600" : "text-green-600"} title={partial ? `of ${fmt(d.open)} open` : undefined}>
                                                    {fmt(value)}{partial ? "*" : ""}
                                                </span>
                                            ) : (
                                                <span className="text-orange-600">{fmt(d.open)}</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* On account — the ledger money that is not linked to any bill
                                (opening balance, unlinked receipts or payments, advances). A
                                row like the bills so the ledger figure adds up in one place;
                                not tickable — an untouched remainder already lands here. */}
                            {onAccount != null && Math.abs(onAccount) > EPS && (
                                <tr className="border-t border-border/50 bg-muted/30" title="Money on the ledger that is not linked to any bill — opening balance, unlinked receipts or payments, advances.">
                                    <td className="w-6 py-1" />
                                    <td className="py-1 pr-1">
                                        <span>On account</span>
                                        <span className="block text-[10px] text-muted-foreground">not bill-wise</span>
                                    </td>
                                    <td className="py-1 pl-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">—</td>
                                    <td className="py-1 pl-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">—</td>
                                    <td className={`py-1 pl-2 text-right font-mono tabular-nums whitespace-nowrap ${onAccount > 0 ? "text-orange-600" : "text-green-700"}`}>
                                        {fmt(Math.abs(onAccount))} {onAccount > 0 ? "Dr" : "Cr"}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    <div className="mt-1.5 space-y-0.5 border-t border-border pt-1.5 text-xs">
                        <div className="flex justify-between text-muted-foreground">
                            <span>Total open</span>
                            <span className="font-mono tabular-nums">₹ {fmt(totalOpen)}</span>
                        </div>
                        {placed > EPS && (
                            <div className="flex justify-between font-medium">
                                <span>Placed by ticks</span>
                                <span className="font-mono tabular-nums">₹ {fmt(placed)}</span>
                            </div>
                        )}
                        {amountTyped && amount - placed > EPS && (
                            <div className="flex justify-between text-muted-foreground">
                                <span>Stays as advance</span>
                                <span className="font-mono tabular-nums">₹ {fmt(round2(amount - placed))}</span>
                            </div>
                        )}
                        {/* The ledger's own figure beside the bill-wise one. They differ
                            whenever money moved without being linked to a bill — an
                            opening balance, an unlinked receipt, an advance — and that
                            difference is named here rather than left as a puzzle. */}
                        {ledgerLabel != null && (
                            <div className="flex justify-between border-t border-border/60 pt-1 font-medium" title="Bills open + on account = the ledger's own balance">
                                <span>Ledger balance</span>
                                <span className="font-mono tabular-nums">{ledgerLabel}</span>
                            </div>
                        )}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                        {amountTyped
                            ? "Ticks fill bills within the amount typed. * = part of the bill."
                            : "Each tick adds the bill to the amount; type an amount first to fill bills within it."}
                        {" "}After Save, the link popup opens with the same ticks.
                    </p>
                </>
            )}
        </div>
    );
}
