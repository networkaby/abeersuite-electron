"use client";

// Bill-wise link popup — "which bill does this money belong to?"
//
// Two ways to fill it, and they produce the same thing:
//   • tick the bills you mean (amount per row is editable, for a part payment)
//   • press Auto, which clears the oldest bills first until the money runs out
//
// Both go through `planLinks`, so the save path never has to know which was used.
// Anything left unplaced is not an error — it stays as the party's advance, which
// is exactly what an unlinked receipt already means.
//
// The list is every OPEN document of that party on the OPPOSITE side, so it is
// not only receipts against sales: a purchase can settle a sale for a party who
// is both customer and supplier, and a journal with a party leg shows up too.
//
// Always links an already-POSTED voucher, in one POST and one transaction — all
// the links land or none. There is deliberately no "link while typing" mode: a
// link is only legal between two posted vouchers, and the voucher forms save and
// post in two steps, so anything held in the form would be a promise the books
// cannot keep. The forms open this popup straight after posting instead.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Wand2, X, HandCoins } from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { extractApiError } from "@/shared/lib/api";
import { round2 } from "@/shared/lib/format/moneyInr";
import { fmt } from "@/shared/lib/format/moneyInr";
import { useValueChange } from "@/shared/hooks/useValueChange";
import { planLinks, reconcilePicks, sumPicks, EPS, type LinkableDoc } from "@/modules/accountancy/lib/billLinkPlan";

/** Money that already moved cannot be settled by creating more money — it needs
 *  linking to a bill instead. The API refuses these too; this only hides the
 *  affordance so the user is never offered something that would be rejected. */
const ALREADY_MONEY = ["RECEIPT", "PAYMENT", "CONTRA"];

/** One line of the POST body: `voucherId` is the name the API asks for — the
 *  spine id of the bill on the other end. */
export type LinkPlan = { voucherId: number; amount: number }[];

/** What the settling voucher needs to know: which way the money goes, whose
 *  bill it is, how much is open on it, and which bill it is. */
export type SettleRequest = {
    kind: "RECEIPT" | "PAYMENT";
    partyAccountId: number;
    amount: number;
    billId: number;
};

// Show the last answer while the fresh one is on its way — the party's open bills
// barely move between two clicks, and a spinner where a table just was reads as a
// bug. Cleared after any successful link so the next open cannot show stale rows.
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; docs: LinkableDoc[]; self: LinkableDoc | null }>();

/** Drop the cached open-bill lists — call after anything that changes them. */
export function clearBillLinkCache(): void {
    cache.clear();
}

function labelFor(d: LinkableDoc): string {
    return d.voucherType.replace(/_/g, " ").toLowerCase();
}

export function BillLinkDialog({
    open, onOpenChange, accountId, partyName, voucherId, onSaved, initialPlan,
}: {
    open:         boolean;
    onOpenChange: (v: boolean) => void;
    /** The party ledger the link is measured on. */
    accountId:    number;
    partyName?:   string;
    /** The posted voucher doing the linking. */
    voucherId:    number;
    /** Called once the links are saved. */
    onSaved?:     () => void;
    /** Ticks made before save (the form's side panel) — the popup opens with them. */
    initialPlan?: Record<number, number>;
}) {
    const [docs, setDocs] = useState<LinkableDoc[]>([]);
    const [self, setSelf] = useState<LinkableDoc | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [picked, setPicked] = useState<Record<number, number>>({});

    const router = useRouter();

    // The server works out which side is eligible from the voucher itself, so the
    // caller never has to reason about debit and credit.
    const key = `${accountId}|${voucherId}`;

    // Ticks carried in from the Receipt/Payment form were made against the list
    // as it looked BEFORE the voucher was posted. Measure them against the list
    // that just arrived: a bill that is gone, or that someone else has settled in
    // the meantime, is dropped or trimmed here and said out loud — rather than
    // being counted in the total on screen and quietly left out of the save.
    // Done while rendering, when a new list lands; the toast follows in an effect.
    const [clampNotice, setClampNotice] = useState<{ count: number } | null>(null);
    const reconcile = (list: LinkableDoc[], picks: Record<number, number>) => {
        const { picks: kept, clamped } = reconcilePicks(list, picks);
        if (clamped.length === 0) return picks;
        setClampNotice({ count: clamped.length });
        return kept;
    };
    useEffect(() => {
        if (!clampNotice) return;
        toast.info(clampNotice.count === 1
            ? "One bill you ticked has changed — its amount was adjusted."
            : `${clampNotice.count} bills you ticked have changed — their amounts were adjusted.`);
    }, [clampNotice]);

    // Each open starts from the form's ticks, over this browser's copy of the
    // list when it has one (the effect below re-reads it once it is stale).
    const openFor = open && accountId ? `${key}|${JSON.stringify(initialPlan ?? {})}` : null;
    const docsChanged = useValueChange(docs);
    if (useValueChange(openFor, null) && openFor !== null) {
        const hit = cache.get(key);
        if (hit) { setDocs(hit.docs); setSelf(hit.self); }
        setLoading(!hit);
        setPicked(hit && hit.docs.length > 0 ? reconcile(hit.docs, initialPlan ?? {}) : initialPlan ?? {});
    } else if (docsChanged && open && docs.length > 0) {
        const next = reconcile(docs, picked);
        if (next !== picked) setPicked(next);
    }

    useEffect(() => {
        if (!open || !accountId) return;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < TTL_MS) return;
        let cancelled = false;
        const params = new URLSearchParams({
            accountId: String(accountId),
            excludeId: String(voucherId),
        });
        axios.get<{ docs: LinkableDoc[]; self: LinkableDoc | null }>(
            `/api/accountancy/allocations/open?${params.toString()}`,
        )
            .then(({ data }) => {
                cache.set(key, { at: Date.now(), docs: data.docs, self: data.self });
                if (cancelled) return;
                setDocs(data.docs);
                setSelf(data.self);
            })
            .catch((e) => { if (!cancelled) toast.error(extractApiError(e, "Could not load this party's open bills")); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [open, accountId, voucherId, key]);

    // The server reports the true open amount — it already knows what earlier links
    // took, and what the bill's own up-front tenders covered.
    const available = self?.open ?? 0;
    const allocated = round2(Object.values(picked).reduce((s, n) => s + n, 0));
    const remaining = round2(available - allocated);
    const over = allocated > available + 0.01;

    const toggle = (d: LinkableDoc) => {
        setPicked((prev) => {
            if (prev[d.universalVoucherId] !== undefined) {
                const next = { ...prev };
                delete next[d.universalVoucherId];
                return next;
            }
            const already = round2(Object.values(prev).reduce((s, n) => s + n, 0));
            const take = round2(Math.min(Math.max(0, available - already), d.open));
            return take <= EPS ? prev : { ...prev, [d.universalVoucherId]: take };
        });
    };

    const setRowAmount = (d: LinkableDoc, raw: string) => {
        const val = parseFloat(raw);
        setPicked((prev) => {
            if (!Number.isFinite(val) || val <= 0) {
                const next = { ...prev };
                delete next[d.universalVoucherId];
                return next;
            }
            // Never let a row claim more than that bill has open.
            return { ...prev, [d.universalVoucherId]: round2(Math.min(val, d.open)) };
        });
    };

    // Auto — overdue first, then nearest due date, and the smaller bill on a tie.
    // It builds AROUND what the user already ticked: those ticks are kept as they
    // are and their money is taken out of the budget first, so pressing Auto can
    // only ever fill the remainder. A hand-made choice is never overwritten.
    const auto = () => {
        const before = sumPicks(picked);
        const { picks, clamped } = planLinks(docs, available, { existing: picked });
        if (sumPicks(picks) - before <= EPS) {
            toast.info(before > EPS
                ? "Nothing more to place — the amount is already spread over the bills you ticked."
                : "Nothing to link — this party has no open bills on the other side.");
            return;
        }
        setPicked(picks);
        if (clamped.length > 0) toast.info(`${clamped.length} tick(s) no longer fit and were adjusted.`);
    };

    /** Reset — every tick goes, auto-made and hand-made alike. Links already
     *  SAVED against this voucher are untouched: a tick is only a proposal, and
     *  a bill with nothing proposed on it is simply left off the save. */
    const reset = () => setPicked({});

    // Each line says what the pair should TOTAL, not what to add — so saving the
    // same screen twice lands on the same figure instead of settling twice. A
    // tick is money being ADDED to whatever this voucher already put on that
    // bill, which is why the two are summed here.
    const buildPlan = (): LinkPlan =>
        docs
            .filter((d) => (picked[d.universalVoucherId] ?? 0) > EPS)
            .map((d) => ({
                voucherId: d.universalVoucherId,
                amount:    round2((d.linkedHere ?? 0) + picked[d.universalVoucherId]),
            }));

    const save = async () => {
        const plan = buildPlan();
        if (plan.length === 0) {
            toast.error("Tick at least one bill, or press Auto.");
            return;
        }
        setSaving(true);
        try {
            await axios.post("/api/accountancy/allocations", { accountId, voucherId, links: plan });
            clearBillLinkCache();
            toast.success(plan.length === 1 ? "Linked to the bill." : `Linked to ${plan.length} bills.`);
            onSaved?.();
            onOpenChange(false);
        } catch (e) {
            toast.error(extractApiError(e, "Could not link"));
        } finally {
            setSaving(false);
        }
    };

    // A bill can be settled by creating money; money already moved cannot.
    const canCreate = self !== null && !ALREADY_MONEY.includes(self.voucherType);
    // Which way the money goes is decided by the bill, not asked: a receivable is
    // received, a payable is paid.
    const createVerb = self?.side === 1 ? "Receive" : "Pay";

    // The settling voucher is made on its own screen, not in here. This popup
    // only knows which bill and how much, so it hands those over and steps out
    // of the way — the receipt / payment form then owns the date, the cash or
    // bank account, and everything else a voucher needs.
    const openSettlingVoucher = () => {
        const kind = self?.side === 1 ? "RECEIPT" : "PAYMENT";
        onOpenChange(false);
        const path = kind === "RECEIPT" ? "/vouchers/receipts/new" : "/vouchers/payments/new";
        const qs = new URLSearchParams({
            partyAccountId: String(accountId),
            amount:         String(round2(available)),
            billId:         String(voucherId),
        });
        router.push(`${path}?${qs.toString()}`);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Link to bills</DialogTitle>
                    <DialogDescription>
                        {partyName ? `${partyName} — ` : ""}
                        ₹ {fmt(available)} to place{self ? ` from ${self.ref}` : ""}. Tick the bills this settles, or
                        press Auto to clear the overdue ones first.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="animate-spin text-muted-foreground" size={20} />
                    </div>
                ) : available <= EPS ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                        {self
                            ? `${self.ref} is fully linked already — nothing left to place.`
                            : "This voucher has nothing against this party to place."}
                    </p>
                ) : docs.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        Nothing open on the other side for this party.
                        {canCreate
                            ? ` Use ${createVerb.toLowerCase()} now below to settle it straight away.`
                            : " Leave it unlinked and it stays as an advance — you can link it to a bill later."}
                    </p>
                ) : (
                    <div className="max-h-[52vh] overflow-y-auto rounded border border-border">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="w-10 px-3 py-2" />
                                    <th className="px-3 py-2 text-left font-medium">Voucher</th>
                                    <th className="px-3 py-2 text-left font-medium">Date</th>
                                    <th className="px-3 py-2 text-right font-medium">Total</th>
                                    <th className="px-3 py-2 text-right font-medium">Already linked</th>
                                    <th className="px-3 py-2 text-right font-medium">Open</th>
                                    <th className="w-32 px-3 py-2 text-right font-medium">Link</th>
                                </tr>
                            </thead>
                            <tbody>
                                {docs.map((d) => {
                                    const value = picked[d.universalVoucherId];
                                    const ticked = value !== undefined;
                                    return (
                                        <tr
                                            key={d.universalVoucherId}
                                            className={`border-t border-border ${ticked ? "bg-primary/5" : "hover:bg-muted/40"}`}
                                        >
                                            <td className="px-3 py-2">
                                                <Checkbox checked={ticked} onCheckedChange={() => toggle(d)} />
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className="font-mono text-xs">{d.ref}</span>
                                                <span className="ml-2 text-xs text-muted-foreground">{labelFor(d)}</span>
                                            </td>
                                            <td className="px-3 py-2 text-xs text-muted-foreground">
                                                {new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono text-xs">{fmt(d.face)}</td>
                                            <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                                                {d.linked > EPS ? fmt(d.linked) : "—"}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono text-xs text-orange-600">{fmt(d.open)}</td>
                                            <td className="px-3 py-2">
                                                <Input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={value ?? ""}
                                                    placeholder="0.00"
                                                    onChange={(e) => setRowAmount(d, e.target.value)}
                                                    className="h-8 text-right text-xs"
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Nothing to link against? Go and make the settling voucher —
                    which kind it is follows from the bill's own side, so there
                    is no "receipt or payment?" question to get wrong. */}
                {canCreate && available > EPS && (
                    <div className="rounded border border-border bg-muted/30 p-3">
                        <Button type="button" size="sm" variant="outline" onClick={openSettlingVoucher}>
                            <HandCoins size={14} className="mr-1" /> {createVerb} now — open a{" "}
                            {self?.side === 1 ? "receipt" : "payment"} for this bill
                        </Button>
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={auto} disabled={docs.length === 0}>
                            <Wand2 size={14} className="mr-1" /> Auto (overdue first)
                        </Button>
                        {allocated > EPS && (
                            <Button type="button" size="sm" variant="ghost" onClick={reset}>
                                <X size={14} className="mr-1" /> Reset
                            </Button>
                        )}
                    </div>
                    <div className={over ? "text-destructive" : "text-muted-foreground"}>
                        <span className="font-mono">₹ {fmt(allocated)}</span> linked ·{" "}
                        {over
                            ? `₹ ${fmt(round2(allocated - available))} more than this voucher has`
                            : `₹ ${fmt(Math.max(0, remaining))} stays as advance`}
                    </div>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={save} disabled={saving || over || allocated <= EPS}>
                        {saving && <Loader2 className="mr-1 animate-spin" size={14} />}
                        Link
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
