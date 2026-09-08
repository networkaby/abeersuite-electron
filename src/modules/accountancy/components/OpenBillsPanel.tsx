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
import { Loader2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { fmt } from "@/utils/constants";
import { extractApiError } from "@/shared/lib/api";
import { round2 } from "@/shared/lib/format/moneyInr";
import { planLinks, sumPicks, EPS, type LinkableDoc, type BillPicks } from "@/modules/accountancy/lib/billLinkPlan";

export type { BillPicks };

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

// BOTH sides of the party, deliberately. Asking for one side made everything on
// the other side a nameless remainder the panel had to call "on account" — when
// in truth every rupee on a party's ledger belongs to a document that has a
// reference: an opening bill, a sale, a return, a receipt. The lump was our
// missing question, not the party's unattributed money.
function fetchOpenBills(key: string, accountId: number): Promise<LinkableDoc[]> {
    const running = inflight.get(key);
    if (running) return running;
    const p = axios.get<{ docs: LinkableDoc[] }>(`/api/accountancy/allocations/open?accountId=${accountId}`)
        .then((r) => {
            cache.set(key, { at: Date.now(), docs: r.data.docs });
            return r.data.docs;
        })
        .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
}

const sumOf = sumPicks;

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
        fetchOpenBills(key, accountId)
            .then((docs) => { if (!cancelled) setResult({ key, docs }); })
            .catch((e) => { if (!cancelled) setResult({ key, error: extractApiError(e, "Could not load open bills") }); });
        return () => { cancelled = true; };
    }, [accountId, key]);

    // Fresh answer for this key wins; otherwise a cached one (even if stale, while
    // the refresh is on its way); otherwise loading.
    const current = result?.key === key ? result : null;
    const all: LinkableDoc[] | null = current?.docs ?? cache.get(key)?.docs ?? null;
    const error = current?.error ?? null;

    // What THIS voucher can settle, and what it cannot. The second list is not a
    // leftover: those are the party's open references on the other side — an
    // opening bill, an advance already received, a sale return — each of which a
    // document of the opposite kind will settle one day. Shown by name, because
    // there is no such thing as money on a party's ledger with no reference.
    const docs = all === null ? null : all.filter((d) => d.side === side);
    const others = all === null ? [] : all.filter((d) => d.side !== side);

    const totalOpen = (docs ?? []).reduce((s, d) => s + d.open, 0);
    const totalOther = others.reduce((s, d) => s + d.open, 0);
    // Both lists come off the party's GL legs, so they must account for the whole
    // ledger between them. Anything left over is not "on account" — it is an
    // opening balance still sitting as a bare figure on the master, with no
    // voucher behind it, and it is named as exactly that.
    const unexplained = ledgerOwed != null && all !== null
        ? round2(ledgerOwed - round2(totalOpen - totalOther))
        : null;
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

    /**
     * Type an amount straight onto one bill — how the money gets DIVIDED between
     * bills rather than filled bill-by-bill from the top.
     *
     * Two ceilings, and the lower one wins: a bill can never take more than it
     * has open, and when an amount has been typed on the row, the bills together
     * can never take more than that amount. With no amount typed yet the ticks
     * are what build it, so only the bill's own open applies and the row total
     * follows what is placed.
     */
    const setPick = (d: LinkableDoc, raw: string) => {
        const id = d.universalVoucherId;
        const next = { ...picks };
        const val = parseFloat(raw);

        if (!Number.isFinite(val) || val <= 0) {
            delete next[id];
        } else {
            const others = round2(sumOf(next) - (next[id] ?? 0));
            const cap = amountTyped
                ? Math.min(d.open, Math.max(0, round2(amount - others)))
                : d.open;
            const take = round2(Math.min(val, cap));
            if (take <= EPS) delete next[id];
            else next[id] = take;
        }

        const nextAmount = amountTyped ? null : sumOf(next);
        if (nextAmount !== null) setSetByTicks(nextAmount);
        onChange(next, nextAmount);
    };

    // Auto — overdue first, then nearest due date, the smaller bill on a tie.
    // Ticks already made by hand are kept exactly as they are and paid for first,
    // so Auto can only fill what is still unplaced. With no amount typed yet it
    // offers to settle everything open, the same way ticking every row would.
    const auto = () => {
        const list = docs ?? [];
        const budget = amountTyped ? amount : round2(totalOpen);
        const before = sumOf(picks);
        const { picks: next, clamped } = planLinks(list, budget, { existing: picks });
        if (sumOf(next) - before <= EPS) {
            toast.info(before > EPS
                ? "Nothing more to place — the amount is already spread over the bills you ticked."
                : "Nothing open to settle for this party.");
            return;
        }
        const nextAmount = amountTyped ? null : sumOf(next);
        if (nextAmount !== null) setSetByTicks(nextAmount);
        onChange(next, nextAmount);
        if (clamped.length > 0) toast.info(`${clamped.length} tick(s) no longer fit and were adjusted.`);
    };

    /** Reset — every tick goes, hand-made and auto-made alike. An amount the
     *  user typed stays; one that the ticks themselves put there goes with them. */
    const reset = () => {
        const nextAmount = amountTyped ? null : 0;
        if (nextAmount !== null) setSetByTicks(null);
        onChange({}, nextAmount);
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
            ) : docs.length === 0 && others.length === 0 && !(unexplained != null && Math.abs(unexplained) > EPS) ? (
                <p className="mt-2 text-xs text-muted-foreground">
                    Nothing open. This {side === 1 ? "receipt" : "payment"} stands as its own open reference —
                    a later bill can be settled against it.
                </p>
            ) : (
                <>
                    {/* Capped so a party with forty open bills cannot push Save
                        off the bottom of the screen. */}
                    <div className="mt-2 max-h-[46vh] overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card">
                            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                <th className="w-6" />
                                <th className="py-1 text-left font-medium">Bill</th>
                                <th className="py-1 text-right font-medium">Total</th>
                                <th className="py-1 text-right font-medium">Open</th>
                                <th className="py-1 text-right font-medium">Link now</th>
                            </tr>
                        </thead>
                        <tbody>
                            {docs.map((d) => {
                                const value = picks[d.universalVoucherId];
                                const ticked = value !== undefined;
                                const placing = value ?? 0;
                                const willClose = placing >= d.open - EPS;
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
                                        {/* Open, and straight under it what this bill will be
                                            left at once the amount beside it is linked. The
                                            answer to "how much of this is still mine to chase"
                                            shown before and after, rather than a `*` the reader
                                            has to look up in a footnote. */}
                                        <td className="py-1 pl-2 text-right font-mono tabular-nums whitespace-nowrap">
                                            <span className={placing > EPS ? "text-muted-foreground line-through decoration-muted-foreground/50" : "text-orange-600"}>
                                                {fmt(d.open)}
                                            </span>
                                            {placing > EPS && (
                                                <span className={`block text-[10px] ${willClose ? "text-green-600" : "text-amber-600"}`}>
                                                    → {fmt(round2(d.open - placing))}
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-1 pl-2 text-right" onClick={(e) => e.stopPropagation()}>
                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                aria-label={`Link now against ${d.ref}`}
                                                placeholder="0.00"
                                                value={value ?? ""}
                                                onChange={(e) => setPick(d, e.target.value)}
                                                className="h-6 w-[86px] px-1.5 text-right font-mono text-xs tabular-nums"
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* The other side of the party's book, by name. A
                                {side === 1 ? "receipt" : "payment"} cannot settle these — both
                                are the same side — but they are open references all the same,
                                and leaving them out was what forced the old nameless "on
                                account" line. */}
                            {others.length > 0 && (
                                <>
                                    <tr className="border-t border-border">
                                        <td />
                                        <td colSpan={3} className="pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                            {side === 1 ? "Already with us" : "They owe us"}
                                            <span className="ml-1 normal-case tracking-normal opacity-70">
                                                — a {side === 1 ? "bill" : "receipt"} settles these, not this voucher
                                            </span>
                                        </td>
                                    </tr>
                                    {others.map((d) => (
                                        <tr key={d.universalVoucherId} className="border-t border-border/50 text-muted-foreground">
                                            <td className="w-6 py-1" />
                                            <td className="py-1 pr-1">
                                                <span className="font-mono whitespace-nowrap">{d.ref}</span>
                                                <span className="block text-[10px] opacity-80">
                                                    {new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                                </span>
                                            </td>
                                            <td className="py-1 pl-2 text-right font-mono tabular-nums whitespace-nowrap">{fmt(d.face)}</td>
                                            <td className="py-1 pl-2 text-right font-mono tabular-nums whitespace-nowrap text-green-700">
                                                {fmt(d.open)} {side === 1 ? "Cr" : "Dr"}
                                            </td>
                                            <td className="py-1 pl-2 text-right font-mono tabular-nums whitespace-nowrap">—</td>
                                        </tr>
                                    ))}
                                </>
                            )}

                            {/* Only when the two lists do NOT account for the whole ledger:
                                an opening balance still sitting as a bare number on the master,
                                with no voucher behind it. Named for what it is, with what to do
                                about it — not filed away as "on account". */}
                            {unexplained != null && Math.abs(unexplained) > EPS && (
                                <tr className="border-t border-border/50 bg-amber-50/60" title="This much of the ledger has no voucher behind it — convert the party's opening balance to a bill (Masters → Opening Balance → Convert all to bills) and it gets a reference like everything else.">
                                    <td className="w-6 py-1" />
                                    <td className="py-1 pr-1">
                                        <span className="text-amber-800">Opening balance, not yet a bill</span>
                                        <span className="block text-[10px] text-amber-700/80">no reference yet — convert it in Masters</span>
                                    </td>
                                    <td className="py-1 pl-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">—</td>
                                    <td className={`py-1 pl-2 text-right font-mono tabular-nums whitespace-nowrap ${unexplained > 0 ? "text-orange-600" : "text-green-700"}`}>
                                        {fmt(Math.abs(unexplained))} {unexplained > 0 ? "Dr" : "Cr"}
                                    </td>
                                    <td className="py-1 pl-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">—</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    </div>
                    <div className="mt-2 flex gap-2">
                        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={auto}>
                            <Wand2 size={13} className="mr-1" /> Auto
                        </Button>
                        {placed > EPS && (
                            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={reset}>
                                <X size={13} className="mr-1" /> Reset
                            </Button>
                        )}
                    </div>
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
                                <span>Stays as its own reference</span>
                                <span className="font-mono tabular-nums">₹ {fmt(round2(amount - placed))}</span>
                            </div>
                        )}
                        {totalOther > EPS && (
                            <div className="flex justify-between text-muted-foreground">
                                <span>{side === 1 ? "Already with us" : "They owe us"}</span>
                                <span className="font-mono tabular-nums">₹ {fmt(totalOther)}</span>
                            </div>
                        )}
                        {/* The ledger's own figure, which the two lists above now add up to
                            on their own — every rupee sitting against a reference. When it
                            does not add up, the row inside the table says why. */}
                        {ledgerLabel != null && (
                            <div className="flex justify-between border-t border-border/60 pt-1 font-medium" title="What is open on each side accounts for the whole ledger — every amount has a reference behind it.">
                                <span>Ledger balance</span>
                                <span className="font-mono tabular-nums">{ledgerLabel}</span>
                            </div>
                        )}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                        {amountTyped
                            ? "Ticks fill bills within the amount typed — or type into Link now to divide it yourself. Auto fills the rest, overdue first, without touching your ticks."
                            : "Each tick adds the bill to the amount; Auto offers everything open. Type an amount first to fill bills within it."}
                        {" "}After Save, the link popup opens with the same ticks.
                    </p>
                </>
            )}
        </div>
    );
}
