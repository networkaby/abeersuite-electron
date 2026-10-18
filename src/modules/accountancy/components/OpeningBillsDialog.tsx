"use client";

// Bill-wise details for a party's opening balance.
//
// One number on the master says a customer owed ₹63,480 when the books began. It
// does not say which bills that was, so nothing can be aged and nothing can be
// settled against it. This dialog lets that one number become the bills it really
// was — a number, a date and an amount each — and from then on every one of them
// behaves like any other bill: it appears in Receivables, it ages, and a receipt
// can be linked to it.
//
// The bill number and date are the user's own record of the old books. They are
// labels: nothing computes from them except ageing, which uses the date.
//
// One shared component on purpose — an opening balance is editable from the
// Opening Balance master page, the ledger master, and each customer's profile,
// and all of them should reach the same editor rather than three near-copies.

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { extractApiError } from "@/shared/lib/api";
import { round2 } from "@/shared/lib/format/moneyInr";
import { fmt } from "@/shared/lib/format/moneyInr";

type Row = {
    universalVoucherId?: number;
    ref:    string;
    date:   string;
    amount: string;
    /** Settled amount — a bill with money against it cannot be dropped. */
    linked: number;
};

type Loaded = {
    accountName:       string;
    /** Bill-wise is only kept for Sundry Debtors and Creditors. The server
     *  decides, so every surface can mount this without redoing the group walk. */
    isParty:           boolean;
    scalarOpening:     number | null;
    scalarOpeningType: "DEBIT" | "CREDIT" | null;
    bills:             { universalVoucherId: number; ref: string; date: string; amount: number; type: "DEBIT" | "CREDIT"; linked: number }[];
    defaults:          { ref: string; date: string };
};

export function OpeningBillsDialog({
    open, onOpenChange, accountId, onSaved, retarget,
}: {
    open:         boolean;
    onOpenChange: (v: boolean) => void;
    accountId:    number;
    /** Called after a successful save, so the caller can refresh its figures. */
    onSaved?:     () => void;
    /**
     * A new figure typed on the master card while the opening already lives in
     * bills. The breakup opens prefilled with it: one bill takes the new amount,
     * several must be adjusted to add up to it, 0 empties the list (clears it).
     */
    retarget?:    { amount: number; type: "DEBIT" | "CREDIT" };
}) {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [data, setData] = useState<Loaded | null>(null);
    const [rows, setRows] = useState<Row[]>([]);
    const [type, setType] = useState<"DEBIT" | "CREDIT">("DEBIT");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data: d } = await axios.get<Loaded>(`/api/accountancy/accounts/${accountId}/opening-bills`);
            setData(d);
            if (d.bills.length > 0) {
                setType(retarget?.type ?? d.bills[0].type);
                const loaded = d.bills.map((b) => ({
                    universalVoucherId: b.universalVoucherId,
                    ref: b.ref, date: b.date, amount: String(b.amount), linked: b.linked,
                }));
                // Clearing drops every bill; one bill simply takes the new figure.
                if (retarget && retarget.amount <= 0) setRows([]);
                else if (retarget && loaded.length === 1) setRows([{ ...loaded[0], amount: String(retarget.amount) }]);
                else setRows(loaded);
            } else {
                // First time: seed one row from the master figure, so the common
                // case ("it was all one bill") is already filled in.
                setType(d.scalarOpeningType ?? "DEBIT");
                setRows([{
                    ref:    d.defaults.ref,
                    date:   d.defaults.date,
                    amount: d.scalarOpening != null ? String(d.scalarOpening) : "",
                    linked: 0,
                }]);
            }
        } catch (e) {
            toast.error(extractApiError(e, "Could not load the opening breakup"));
        } finally {
            setLoading(false);
        }
    }, [accountId, retarget]);

    useEffect(() => {
        if (open && accountId) void load();
    }, [open, accountId, load]);

    const total = round2(rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0));
    // While the party is still on the master figure, the breakup has to add up to
    // it — the money is not changing, only gaining detail.
    const target = retarget ? retarget.amount : (data?.scalarOpening ?? null);
    // With bills already posted, saving an empty list is how the opening is cleared.
    const clearing = rows.length === 0 && (data?.bills.length ?? 0) > 0;
    const mismatch = target !== null && Math.abs(total - target) > 0.01;

    const setRow = (i: number, patch: Partial<Row>) =>
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

    const addRow = () => setRows((prev) => [...prev, {
        ref:    data?.defaults.ref ?? "Opening Balance",
        date:   data?.defaults.date ?? new Date().toISOString().slice(0, 10),
        amount: "",
        linked: 0,
    }]);

    const removeRow = (i: number) => {
        if ((rows[i].linked ?? 0) > 0.005) {
            toast.error("That bill already has money settled against it — unlink it first.");
            return;
        }
        setRows((prev) => prev.filter((_, idx) => idx !== i));
    };

    const save = async () => {
        const bills = rows
            .map((r) => ({
                universalVoucherId: r.universalVoucherId,
                ref:    r.ref.trim(),
                date:   r.date,
                amount: round2(parseFloat(r.amount) || 0),
            }))
            .filter((b) => b.amount > 0.005);
        if (bills.length === 0 && !clearing) {
            toast.error("Add at least one bill with an amount.");
            return;
        }
        if (mismatch) {
            toast.error(`The bills add up to ₹ ${fmt(total)}, but the opening balance is ₹ ${fmt(target!)}.`);
            return;
        }
        setSaving(true);
        try {
            await axios.put(`/api/accountancy/accounts/${accountId}/opening-bills`, { type, bills });
            toast.success(bills.length === 0 ? "Opening balance cleared."
                : bills.length === 1 ? "Opening bill saved." : `${bills.length} opening bills saved.`);
            onSaved?.();
            onOpenChange(false);
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the opening bills"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Bill-wise details</DialogTitle>
                    <DialogDescription>
                        {data?.accountName ? `${data.accountName} — ` : ""}
                        which bills make up the opening balance. Each one ages and can be settled on its own.
                        The bill number and date are your record of the old books.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="animate-spin text-muted-foreground" size={20} />
                    </div>
                ) : data && !data.isParty ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                        {data.accountName} is not a party ledger. Bill-wise details are kept only for Sundry Debtors
                        and Sundry Creditors — a bank, cash or capital opening has no bills behind it to age or settle.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {/* The side is NOT a choice. The opening balance already
                            says which way it goes, so asking again could only
                            introduce a wrong answer — it is shown, not picked. */}
                        <p className="text-sm text-muted-foreground">
                            {clearing ? "No bills — saving clears the opening balance" : type === "DEBIT" ? "Debit — they owe us" : "Credit — we owe them"}
                            {target !== null && !clearing && (
                                <> · {retarget ? "new opening balance" : "opening balance on the master"} <span className="font-mono">₹ {fmt(target)}</span></>
                            )}
                        </p>

                        <div className="max-h-[46vh] overflow-y-auto rounded border border-border">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium">Bill no.</th>
                                        <th className="w-40 px-3 py-2 text-left font-medium">Date</th>
                                        <th className="w-36 px-3 py-2 text-right font-medium">Amount</th>
                                        <th className="w-28 px-3 py-2 text-right font-medium">Settled</th>
                                        <th className="w-10 px-3 py-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r, i) => (
                                        <tr key={r.universalVoucherId ?? `new-${i}`} className="border-t border-border">
                                            <td className="px-3 py-2">
                                                <Input
                                                    value={r.ref}
                                                    onChange={(e) => setRow(i, { ref: e.target.value })}
                                                    className="h-8 text-sm"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <TallyDateInput
                                                    value={r.date}
                                                    onValueChange={(iso) => setRow(i, { date: iso })}
                                                    className="h-8 text-sm"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <Input
                                                    type="text" inputMode="decimal"
                                                    value={r.amount}
                                                    onChange={(e) => setRow(i, { amount: e.target.value })}
                                                    className="h-8 text-right text-sm"
                                                />
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                                                {r.linked > 0.005 ? fmt(r.linked) : "—"}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => removeRow(i)}
                                                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                                                    title={r.linked > 0.005 ? "Settled — unlink it first" : "Remove this bill"}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between">
                            <Button type="button" size="sm" variant="outline" onClick={addRow}>
                                <Plus size={14} className="mr-1" /> Add a bill
                            </Button>
                            <p className={`text-sm ${mismatch ? "text-destructive" : "text-muted-foreground"}`}>
                                Total <span className="font-mono">₹ {fmt(total)}</span>
                                {mismatch && target !== null && (
                                    <> · needs to be <span className="font-mono">₹ {fmt(target)}</span></>
                                )}
                            </p>
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button type="button" variant={clearing ? "destructive" : "default"} onClick={save} disabled={saving || loading || mismatch || data?.isParty === false}>
                        {saving && <Loader2 className="mr-1 animate-spin" size={14} />}
                        {clearing ? "Clear opening balance" : "Save breakup"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
