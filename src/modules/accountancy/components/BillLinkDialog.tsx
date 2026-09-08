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

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Wand2, X, HandCoins } from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { extractApiError } from "@/shared/lib/api";
import { round2 } from "@/shared/lib/format/moneyInr";
import { fmt } from "@/utils/constants";
import { isMoneyGroupName } from "@/modules/accountancy/lib/moneyAccount";
import { planLinks, EPS, type LinkableDoc } from "@/modules/accountancy/lib/billLinkPlan";

/** Just enough of a ledger to offer it as the till the money moves through. */
type MoneyAccount = { id: number; name: string; code: string | null; group: { name: string } | null };

/** Money that already moved cannot be settled by creating more money — it needs
 *  linking to a bill instead. The API refuses these too; this only hides the
 *  affordance so the user is never offered something that would be rejected. */
const ALREADY_MONEY = ["RECEIPT", "PAYMENT", "CONTRA"];

export type LinkPlan = { universalVoucherId: number; amount: number }[];

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
    open, onOpenChange, accountId, partyName, voucherId, onSaved,
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
}) {
    const [docs, setDocs] = useState<LinkableDoc[]>([]);
    const [self, setSelf] = useState<LinkableDoc | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [picked, setPicked] = useState<Record<number, number>>({});

    // "Receive now / Pay now" — when there is nothing to link against, make the
    // settling voucher here instead of sending the user off to a blank form.
    const [moneyAccounts, setMoneyAccounts] = useState<MoneyAccount[]>([]);
    const [createOpen, setCreateOpen] = useState(false);
    const [createAmount, setCreateAmount] = useState("");
    const [createDate, setCreateDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [createMoneyId, setCreateMoneyId] = useState<string>("");
    const [creating, setCreating] = useState(false);

    // The server works out which side is eligible from the voucher itself, so the
    // caller never has to reason about debit and credit.
    const key = `${accountId}|${voucherId}`;

    const load = useCallback(async () => {
        const hit = cache.get(key);
        if (hit) { setDocs(hit.docs); setSelf(hit.self); }
        if (hit && Date.now() - hit.at < TTL_MS) return;
        setLoading(!hit);
        try {
            const params = new URLSearchParams({
                accountId: String(accountId),
                excludeId: String(voucherId),
            });
            const { data } = await axios.get<{ docs: LinkableDoc[]; self: LinkableDoc | null }>(
                `/api/accountancy/allocations/open?${params.toString()}`,
            );
            cache.set(key, { at: Date.now(), docs: data.docs, self: data.self });
            setDocs(data.docs);
            setSelf(data.self);
        } catch (e) {
            toast.error(extractApiError(e, "Could not load this party's open bills"));
        } finally {
            setLoading(false);
        }
    }, [accountId, voucherId, key]);

    useEffect(() => {
        if (!open || !accountId) return;
        setPicked({});
        setCreateOpen(false);
        void load();
    }, [open, accountId, load]);

    // Only fetched when the user actually opens the create panel — most visits to
    // this popup are a plain link and never need the ledger list.
    useEffect(() => {
        if (!createOpen || moneyAccounts.length > 0) return;
        axios.get<MoneyAccount[]>("/api/accountancy/gl-accounts?includeParties=false")
            .then((r) => setMoneyAccounts(r.data.filter((a) => isMoneyGroupName(a.group?.name))))
            .catch((e) => toast.error(extractApiError(e, "Could not load cash and bank accounts")));
    }, [createOpen, moneyAccounts.length]);

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

    // Auto — oldest first, exactly the order the POS surplus already clears dues in.
    const auto = () => {
        const plan = planLinks(docs, available);
        if (plan.length === 0) {
            toast.info("Nothing to link — this party has no open bills on the other side.");
            return;
        }
        setPicked(Object.fromEntries(plan.map((p) => [p.universalVoucherId, p.amount])));
    };

    const buildPlan = (): LinkPlan =>
        docs
            .filter((d) => (picked[d.universalVoucherId] ?? 0) > EPS)
            .map((d) => ({ universalVoucherId: d.universalVoucherId, amount: picked[d.universalVoucherId] }));

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

    const createAndSettle = async () => {
        const amount = round2(parseFloat(createAmount));
        if (!Number.isFinite(amount) || amount <= EPS) {
            toast.error("Enter how much is being settled.");
            return;
        }
        if (amount > available + 0.01) {
            toast.error(`Only ₹ ${fmt(available)} is open on this bill.`);
            return;
        }
        if (!createMoneyId) {
            toast.error(`Pick the account the money ${self?.side === 1 ? "comes into" : "goes out of"}.`);
            return;
        }
        setCreating(true);
        try {
            const { data } = await axios.post<{ kind: string; voucherRef: string }>(
                "/api/accountancy/allocations/settle",
                {
                    accountId,
                    billVoucherId:  voucherId,
                    amount,
                    moneyAccountId: Number(createMoneyId),
                    date:           createDate,
                },
            );
            clearBillLinkCache();
            toast.success(`${data.kind === "RECEIPT" ? "Receipt" : "Payment"} ${data.voucherRef} created and linked.`);
            onSaved?.();
            onOpenChange(false);
        } catch (e) {
            toast.error(extractApiError(e, "Could not create the settlement voucher"));
        } finally {
            setCreating(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Link to bills</DialogTitle>
                    <DialogDescription>
                        {partyName ? `${partyName} — ` : ""}
                        ₹ {fmt(available)} to place{self ? ` from ${self.ref}` : ""}. Tick the bills this settles, or
                        press Auto to clear the oldest first.
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

                {/* Nothing to link against? Make the settling voucher here. Which
                    kind it is follows from the bill's own side, so there is no
                    "receipt or payment?" question to get wrong. */}
                {canCreate && available > EPS && (
                    <div className="rounded border border-border bg-muted/30 p-3">
                        {!createOpen ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => {
                                setCreateAmount(String(available));
                                setCreateOpen(true);
                            }}>
                                <HandCoins size={14} className="mr-1" /> {createVerb} now — create a{" "}
                                {self?.side === 1 ? "receipt" : "payment"} for this bill
                            </Button>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-medium">
                                        {createVerb} against {self?.ref}
                                    </p>
                                    <Button type="button" size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
                                        <X size={14} />
                                    </Button>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Amount</Label>
                                        <Input
                                            type="text" inputMode="decimal"
                                            value={createAmount}
                                            onChange={(e) => setCreateAmount(e.target.value)}
                                            className="h-8 text-right text-sm"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Date</Label>
                                        <Input
                                            type="date"
                                            value={createDate}
                                            onChange={(e) => setCreateDate(e.target.value)}
                                            className="h-8 text-sm"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">
                                            {self?.side === 1 ? "Received in" : "Paid from"}
                                        </Label>
                                        <Select value={createMoneyId} onValueChange={setCreateMoneyId}>
                                            <SelectTrigger className="h-8 text-sm">
                                                <SelectValue placeholder="Cash / bank…" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {moneyAccounts.map((a) => (
                                                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <Button type="button" size="sm" onClick={createAndSettle} disabled={creating}>
                                    {creating && <Loader2 className="mr-1 animate-spin" size={14} />}
                                    Create &amp; settle
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={auto} disabled={docs.length === 0}>
                            <Wand2 size={14} className="mr-1" /> Auto (oldest first)
                        </Button>
                        {allocated > EPS && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => setPicked({})}>
                                <X size={14} className="mr-1" /> Clear
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
