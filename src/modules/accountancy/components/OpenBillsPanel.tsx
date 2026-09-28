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
// A typed amount brought down below what the ticks place makes the ticks give
// way — bills only, the last in fill order first (fitPicksToAmount); the credits
// ticked alongside stay, since bills − credits is what the amount must cover.
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
import { fmt } from "@/shared/lib/format/moneyInr";
import { extractApiError } from "@/shared/lib/api";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { round2 } from "@/shared/lib/format/moneyInr";
import {
    planLinks, autoLinkOrder, fitPicksToAmount, OPENING_SCALAR_ID, EPS,
    type LinkableDoc, type BillPicks,
} from "@/modules/accountancy/lib/billLinkPlan";

export type { BillPicks };

/** 1 April of the financial year we are in — where an opening balance sits when
 *  nobody has recorded a date for it. Mirrors `defaultOpeningDate` on the server,
 *  which is what actually stamps the bill if this row gets settled against. */
function fyStartIso(): string {
    const now = new Date();
    const year = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    return new Date(Date.UTC(year, 3, 1)).toISOString();
}

// Same idea as the popup's cache: the party's open bills barely move between
// two keystrokes, and a spinner where a table just was reads as a bug.
const TTL_MS = 30_000;
/** What the party has open, plus the opening figure that has no voucher yet. */
type OpenBills = {
    docs: LinkableDoc[];
    scalarOpening: number | null;
    scalarOpeningType: "DEBIT" | "CREDIT" | null;
};

const cache = new Map<string, { at: number; data: OpenBills }>();
// One request per key at a time — React runs the effect more than once around
// a pick (strict mode, re-renders), and each run must not be its own fetch.
const inflight = new Map<string, Promise<OpenBills>>();

/** Drop the cached open-bill lists — call after anything that changes them. */
export function clearOpenBillsCache(): void {
    cache.clear();
}

// BOTH sides of the party, deliberately. Asking for one side made everything on
// the other side a nameless remainder the panel had to call "on account" — when
// in truth every rupee on a party's ledger belongs to a document that has a
// reference: an opening bill, a sale, a return, a receipt. The lump was our
// missing question, not the party's unattributed money.
function fetchOpenBills(key: string, accountId: number): Promise<OpenBills> {
    const running = inflight.get(key);
    if (running) return running;
    const p = axios.get<OpenBills>(`/api/accountancy/allocations/open?accountId=${accountId}`)
        .then((r) => {
            const data: OpenBills = {
                docs: r.data.docs,
                scalarOpening: r.data.scalarOpening ?? null,
                scalarOpeningType: r.data.scalarOpeningType ?? null,
            };
            cache.set(key, { at: Date.now(), data });
            return data;
        })
        .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
}

export function OpenBillsPanel({ accountId, partyName, side, amount, picks, onChange, trimToAmount = true }: {
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
    /** Cut the ticks when a typed amount drops below what they place (default).
     *  Off while the amount is being built up elsewhere and may pass through
     *  lower figures on the way — a note count — with the ticks fitted later. */
    trimToAmount?: boolean;
}) {
    const key = `${accountId}|${side}`;
    // The answer is keyed by the party, so switching party never shows the old
    // party's bills: an answer for another key is simply not this one.
    const [result, setResult] = useState<{ key: string; data?: OpenBills; error?: string } | null>(null);
    // The last amount THIS panel set. While the row still shows it, the ticks
    // drive the amount; the moment it differs, the user typed and the amount
    // drives the ticks.
    const [setByTicks, setSetByTicks] = useState<number | null>(null);

    useEffect(() => {
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < TTL_MS) return;
        let cancelled = false;
        fetchOpenBills(key, accountId)
            .then((data) => { if (!cancelled) setResult({ key, data }); })
            .catch((e) => { if (!cancelled) setResult({ key, error: extractApiError(e, "Could not load open bills") }); });
        return () => { cancelled = true; };
    }, [accountId, key]);

    // A bill settled at another desk while this voucher is being written must
    // leave this list, or the user allocates against something already paid.
    // The TTL cache is dropped for this party first — otherwise the refetch
    // above would look at the cache and decide it had nothing to do. The ticks
    // are the parent's state and are untouched.
    useRealtimeTopics(["ledger"], () => {
        cache.delete(key);
        fetchOpenBills(key, accountId)
            .then((data) => setResult({ key, data }))
            .catch(() => { /* the panel keeps the list it has */ });
    });

    // Fresh answer for this key wins; otherwise a cached one (even if stale, while
    // the refresh is on its way); otherwise loading.
    const current = result?.key === key ? result : null;
    const loaded: OpenBills | null = current?.data ?? cache.get(key)?.data ?? null;
    const all: LinkableDoc[] | null = loaded?.docs ?? null;
    const error = current?.error ?? null;

    // Every open reference the party has, both directions, in ONE list and one
    // order. What kind of voucher made a reference, and whether it began life as
    // an opening balance, changes nothing about how it settles — so nothing here
    // is filed into a special group.
    //
    // The two directions do different work. A reference on the side this voucher
    // settles is a BILL being closed; one on the same side as this voucher is a
    // CREDIT already lying with the party — an advance, a return, an unlinked
    // receipt — which can close bills alongside the money being entered. That is
    // what lets ₹10,000 received close ₹11,000 of bills when ₹1,000 was already
    // there: the amount does not grow, the number of bills it clears does.
    // The opening balance the party still carries as a bare figure on the master.
    // Taken from the server as a fact, not inferred by subtracting the documents
    // from the ledger balance the form happens to hold — that balance goes stale
    // the moment a voucher is saved, and the subtraction then invents an opening
    // balance out of the difference.
    const scalar = loaded?.scalarOpening ?? null;
    const scalarSide: 1 | -1 | null = loaded?.scalarOpeningType === "DEBIT" ? 1
        : loaded?.scalarOpeningType === "CREDIT" ? -1 : null;
    const openingRow: LinkableDoc | null = scalar != null && Math.abs(scalar) > EPS && scalarSide != null
        ? {
            universalVoucherId: OPENING_SCALAR_ID,
            voucherType: "OPENING",
            ref:         "Opening Balance",
            date:        fyStartIso(),
            dueDate:     fyStartIso(),
            side:        scalarSide,
            face:        Math.abs(scalar),
            linked:      0,
            open:        Math.abs(scalar),
        }
        : null;

    const rows: LinkableDoc[] | null = all === null
        ? null
        : autoLinkOrder([...all, ...(openingRow ? [openingRow] : [])]);
    const targets = (rows ?? []).filter((d) => d.side === side);
    const credits = (rows ?? []).filter((d) => d.side !== side);

    const totalOpen = targets.reduce((s, d) => s + d.open, 0);
    const totalOther = credits.reduce((s, d) => s + d.open, 0);
    const isCredit = (d: LinkableDoc) => d.side !== side;

    const onBills = round2(targets.reduce((s, d) => s + (picks[d.universalVoucherId] ?? 0), 0));
    const fromCredits = round2(credits.reduce((s, d) => s + (picks[d.universalVoucherId] ?? 0), 0));
    const amountTyped = amount > EPS && Math.abs(amount - (setByTicks ?? -1)) > EPS;

    // The two directions netted off. Both of these are worth showing because both
    // are a cross-check the reader can make at a glance: the open column nets to
    // the party's ledger balance, and the link column nets to what this voucher
    // itself must be worth once the credits have done their share.
    const netOpen = round2(totalOpen - totalOther);
    const netPlaced = round2(onBills - fromCredits);
    const drCr = (n: number) => (n >= 0 ? (side === 1 ? "Dr" : "Cr") : (side === 1 ? "Cr" : "Dr"));

    // What the money can find no bill for. It does not vanish and it is not
    // "unallocated" — it becomes this voucher's OWN open reference, which a bill
    // raised later can be settled against. Tally calls it a New Ref. Shown as a
    // row of its own so the Link now column adds up to the amount received, and
    // so the ledger's landing figure below counts it: the party is credited with
    // it either way, linked or not.
    const newRef = Math.max(0, round2(amount - netPlaced));

    // A typed amount came down below what the ticks place → the ticks give way.
    // Never while the ticks set the amount themselves (a net-zero bill + credit
    // pair leaves it at 0 on purpose), and never before the list is in — until
    // then there is no telling a bill from a credit.
    useEffect(() => {
        if (!trimToAmount || rows === null) return;
        if (setByTicks != null && Math.abs(amount - setByTicks) <= EPS) return;
        const fitted = fitPicksToAmount(rows, side, picks, amount);
        if (fitted !== picks) onChange(fitted, null);
        // Due only when the amount or what the ticks place moves; picks, rows and
        // onChange are read fresh from this render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trimToAmount, amount, netPlaced, setByTicks, rows === null]);

    /** How much of a credit can be spent: never more than it holds, and never
     *  more than the bills on screen are actually absorbing — a credit that pays
     *  no bill would be money going nowhere. */
    const creditRoom = (d: LinkableDoc) => {
        const otherCredits = round2(fromCredits - (picks[d.universalVoucherId] ?? 0));
        return Math.min(d.open, Math.max(0, round2(onBills - otherCredits)));
    };

    /** What this voucher plus the ticked credits can still put on one more bill. */
    const roomForBill = (d: LinkableDoc) => {
        const already = round2(onBills - (picks[d.universalVoucherId] ?? 0));
        const purse = amountTyped ? round2(amount + fromCredits) : Number.POSITIVE_INFINITY;
        return Math.min(d.open, Math.max(0, round2(purse - already)));
    };

    /** Apply a set of picks, keeping the row amount in step when the ticks own it. */
    const apply = (next: BillPicks) => {
        const bills = round2(targets.reduce((s, t) => s + (next[t.universalVoucherId] ?? 0), 0));
        const creds = round2(credits.reduce((s, c) => s + (next[c.universalVoucherId] ?? 0), 0));
        const nextAmount = amountTyped ? null : round2(bills - creds);
        if (nextAmount !== null) setSetByTicks(nextAmount);
        onChange(next, nextAmount);
    };

    const toggle = (d: LinkableDoc) => {
        const id = d.universalVoucherId;
        const next = { ...picks };
        if (picks[id] !== undefined) {
            delete next[id];
            apply(next);
            return;
        }
        if (isCredit(d)) {
            // A credit is money already with the party — ticking it puts it to
            // work on the bills, so the voucher itself has less to cover.
            const room = creditRoom(d);
            if (room <= EPS) {
                toast.info("Tick the bills this credit should pay first — a credit on its own settles nothing.");
                return;
            }
            next[id] = room;
            apply(next);
            return;
        }
        const room = roomForBill(d);
        if (room <= EPS) {
            toast.info(`₹ ${fmt(round2(amount + fromCredits))} is already placed — raise the amount, or tick a credit, to close more.`);
            return;
        }
        next[id] = round2(room);
        apply(next);
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
            const cap = isCredit(d) ? creditRoom(d) : roomForBill(d);
            const take = round2(Math.min(val, cap));
            if (take <= EPS) delete next[id];
            else next[id] = take;
        }
        apply(next);
    };

    // Auto — overdue first, then nearest due date, the smaller bill on a tie.
    // Ticks already made by hand are kept exactly as they are and paid for first,
    // so Auto can only fill what is still unplaced. With no amount typed yet it
    // offers to settle everything open, the same way ticking every row would.
    const auto = () => {
        // The purse is the money entered PLUS every credit the party already has
        // lying with us — spending those closes bills the amount alone could not
        // reach. With no amount typed yet, settle everything open and let the
        // amount follow.
        const creditsAvailable = round2(credits.reduce((s, c) => s + c.open, 0));
        const budget = amountTyped ? round2(amount + creditsAvailable) : round2(totalOpen);

        const billPicks = Object.fromEntries(
            targets.filter((t) => picks[t.universalVoucherId] !== undefined)
                .map((t) => [t.universalVoucherId, picks[t.universalVoucherId]]),
        );
        const { picks: filled, clamped } = planLinks(targets, budget, { existing: billPicks });
        const bills = round2(Object.values(filled).reduce((s, n) => s + n, 0));

        // Draw only as much credit as the bills actually absorb beyond the amount.
        let need = amountTyped ? Math.max(0, round2(bills - amount)) : Math.min(creditsAvailable, bills);
        const next: BillPicks = { ...filled };
        for (const c of credits) {
            if (need <= EPS) break;
            const take = round2(Math.min(need, c.open));
            if (take <= EPS) continue;
            next[c.universalVoucherId] = take;
            need = round2(need - take);
        }

        if (round2(bills) - onBills <= EPS) {
            toast.info(onBills > EPS
                ? "Nothing more to close — the money is already spread over the bills you ticked."
                : "Nothing open to settle for this party.");
            return;
        }
        apply(next);
        if (clamped.length > 0) toast.info(`${clamped.length} tick(s) no longer fit and were adjusted.`);
    };

    /** Reset — every tick goes, hand-made and auto-made alike, bills and credits
     *  both. An amount the user typed stays; one the ticks put there goes too. */
    const reset = () => {
        if (!amountTyped) setSetByTicks(null);
        onChange({}, amountTyped ? null : 0);
    };

    return (
        <div className="rounded-md border border-border bg-card p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Open bills{partyName ? ` — ${partyName}` : ""}
            </p>
            {error ? (
                <p className="mt-2 text-xs text-destructive">{error}</p>
            ) : rows === null ? (
                <div className="flex justify-center py-4">
                    <Loader2 className="animate-spin text-muted-foreground" size={16} />
                </div>
            ) : rows.length === 0 ? (
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
                            {rows.map((d) => {
                                const value = picks[d.universalVoucherId];
                                const ticked = value !== undefined;
                                const placing = value ?? 0;
                                const willClose = placing >= d.open - EPS;
                                const credit = isCredit(d);
                                const noRef = d.universalVoucherId === OPENING_SCALAR_ID;
                                return (
                                    <tr
                                        key={d.universalVoucherId}
                                        className={`cursor-pointer border-t border-border/50 ${ticked ? "bg-primary/5" : "hover:bg-muted/50"} ${noRef ? "bg-amber-50/50" : ""}`}
                                        onClick={() => toggle(d)}
                                        title={credit
                                            ? "Already with this party. Tick it and it closes bills alongside the amount entered."
                                            : undefined}
                                    >
                                        <td className="w-6 py-1">
                                            <Checkbox checked={ticked} onCheckedChange={() => toggle(d)} onClick={(e) => e.stopPropagation()} />
                                        </td>
                                        <td className="py-1 pr-1">
                                            <span className={`font-mono whitespace-nowrap ${credit ? "text-green-700" : ""}`}>{d.ref}</span>
                                            <span className="block text-[10px] text-muted-foreground">
                                                {noRef
                                                    ? "no reference yet — made into a bill on save"
                                                    : new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                            </span>
                                        </td>
                                        <td className="py-1 pl-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">{fmt(d.face)}</td>
                                        {/* Open, and straight under it what this bill will be
                                            left at once the amount beside it is linked. The
                                            answer to "how much of this is still mine to chase"
                                            shown before and after, rather than a `*` the reader
                                            has to look up in a footnote. */}
                                        <td className="py-1 pl-2 text-right font-mono tabular-nums whitespace-nowrap">
                                            <span className={placing > EPS
                                                ? "text-muted-foreground line-through decoration-muted-foreground/50"
                                                : credit ? "text-green-700" : "text-orange-600"}>
                                                {fmt(d.open)}{credit ? (side === 1 ? " Cr" : " Dr") : ""}
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

                            {/* The money no bill claimed, standing as this voucher's
                                own reference. Not a warning and not a leftover — it
                                is how an advance comes into being, and a bill raised
                                next week settles against it by name. */}
                            {newRef > EPS && (
                                <tr className="border-t border-border/50 bg-sky-50/60" title="No bill takes this part, so it stays open on this voucher as a reference of its own. A later bill can be settled against it.">
                                    <td className="w-6 py-1" />
                                    <td className="py-1 pr-1">
                                        <span className="text-sky-800">New reference</span>
                                        <span className="block text-[10px] text-sky-700/80">
                                            stays open on this {side === 1 ? "receipt" : "payment"}
                                        </span>
                                    </td>
                                    <td className="py-1 pl-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">—</td>
                                    <td className="py-1 pl-2 text-right font-mono tabular-nums text-sky-700 whitespace-nowrap">
                                        {fmt(newRef)} {side === 1 ? "Cr" : "Dr"}
                                    </td>
                                    <td className="py-1 pl-2 pr-1.5 text-right font-mono tabular-nums text-sky-800 whitespace-nowrap">
                                        {fmt(newRef)}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        {/* Sticky, so it stays under the eye while a long list
                            scrolls. Both figures are nets across the two
                            directions, which is what makes them worth reading:
                            the open column comes to the party's ledger balance,
                            and the link column to what this voucher has to be
                            worth once the credits have done their share. */}
                        <tfoot className="sticky bottom-0 bg-card">
                            <tr className="border-t border-border font-medium">
                                <td className="w-6 py-1.5" />
                                <td className="py-1.5 pr-1">Total</td>
                                <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">—</td>
                                <td className="py-1.5 pl-2 text-right font-mono tabular-nums whitespace-nowrap">
                                    <span className={netPlaced + newRef > EPS ? "text-muted-foreground line-through decoration-muted-foreground/50" : ""}>
                                        {fmt(Math.abs(netOpen))} {drCr(netOpen)}
                                    </span>
                                    {/* Where this party lands once the voucher is
                                        saved — the same before-and-after the rows
                                        above show, for the ledger as a whole. The
                                        new reference counts here too: the party is
                                        credited with that money whether a bill
                                        claimed it or not. */}
                                    {netPlaced + newRef > EPS && (
                                        <span className="block text-[10px] text-green-700">
                                            → {fmt(Math.abs(round2(netOpen - netPlaced - newRef)))} {drCr(round2(netOpen - netPlaced - newRef))}
                                        </span>
                                    )}
                                </td>
                                <td className="py-1.5 pl-2 pr-1.5 text-right font-mono tabular-nums whitespace-nowrap">
                                    {netPlaced + newRef > EPS ? fmt(round2(netPlaced + newRef)) : "—"}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                    </div>
                    <div className="mt-2 flex gap-2">
                        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={auto}>
                            <Wand2 size={13} className="mr-1" /> Auto
                        </Button>
                        {onBills > EPS && (
                            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={reset}>
                                <X size={13} className="mr-1" /> Reset
                            </Button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
