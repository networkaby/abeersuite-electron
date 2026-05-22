"use client";

// Contra voucher dialog — Tally-style layout.
// Top: one destination Account (DEBIT side) — where money lands.
// Body: Particulars list — each row is a source account (CREDIT side) + amount.
// Supports multi-source deposits (e.g. petty cash + safe → bank).
// Cur Bal shown under every picked account. Running total at bottom.
// Posts to /api/accountancy/vouchers with type=CONTRA.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { parseAmount, isAmountChars } from "@/utils/numberInput";
import { GlAccountCombobox, type GlAccount } from "./GlAccountCombobox";
import { BalanceHint } from "./BalanceHint";
import { VoucherDialogFooter } from "./VoucherDialogFooter";
import { useContraDialogStore } from "@/store/contraDialogStore";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";

const CONTRA_GROUPS = [ACCOUNT_GROUPS.CASH_IN_HAND, ACCOUNT_GROUPS.BANK_ACCOUNTS] as const;
const isCashOrBank = (a: GlAccount) =>
    CONTRA_GROUPS.includes(a.group?.name as typeof CONTRA_GROUPS[number]);

type ParticularsRow = {
    id: number;
    accountId: number | null;
    amount: string;
};

let rowSeq = 0;
const newRow = (): ParticularsRow => ({ id: ++rowSeq, accountId: null, amount: "" });

export function ContraDialog() {
    const router = useRouter();
    const { open, setOpen } = useContraDialogStore();

    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [nextRef, setNextRef] = useState("");
    const [saving, setSaving] = useState(false);

    const [date, setDate] = useState(() => toIsoDate(new Date()));
    const [sourceId, setSourceId] = useState<number | null>(null);
    const [rows, setRows] = useState<ParticularsRow[]>([newRow()]);
    const [narration, setNarration] = useState("");

    const accountById = new Map<number, GlAccount>(accounts.map((a) => [a.id, a]));
    const cashBankAccounts = accounts.filter(isCashOrBank);
    const sourceAccount = sourceId ? accountById.get(sourceId) : undefined;

    const total = rows.reduce((s, r) => s + parseAmount(r.amount), 0);
    const canSubmit =
        !!sourceId &&
        rows.length > 0 &&
        rows.every((r) => r.accountId && r.accountId !== sourceId && parseAmount(r.amount) > 0);

    const reset = () => {
        setSourceId(null);
        setRows([newRow()]);
        setNarration("");
        setDate(toIsoDate(new Date()));
    };

    useEffect(() => {
        if (!open) return;
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts")
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"));
        axios.get<{ reference: string }>("/api/accountancy/vouchers/next-ref?type=CONTRA")
            .then((r) => setNextRef(r.data.reference))
            .catch(() => setNextRef(""));
    }, [open]);

    const updateRow = (id: number, patch: Partial<ParticularsRow>) =>
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    const addRow = () => setRows((rs) => [...rs, newRow()]);

    const removeRow = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));

    const submit = async (postAfterSave: boolean) => {
        if (!canSubmit) return;
        setSaving(true);
        try {
            // Destination account is DEBIT (funds arrive), each particular is CREDIT (funds leave).
            const lines = [
                { accountId: sourceId!, type: "DEBIT" as const, amount: total },
                ...rows.map((r) => ({
                    accountId: r.accountId!,
                    type: "CREDIT" as const,
                    amount: parseAmount(r.amount),
                })),
            ];

            const created = await axios.post<{ id: number; reference: string }>("/api/accountancy/vouchers", {
                type: "CONTRA",
                date,
                narration: narration.trim() || undefined,
                lines,
            });

            if (postAfterSave) {
                await axios.post(`/api/accountancy/vouchers/${created.data.id}/post`);
                toast.success(`Contra ${created.data.reference} saved & posted`);
            } else {
                toast.success(`Contra ${created.data.reference} saved as draft`);
            }
            reset();
            setOpen(false);
            router.refresh();
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Save failed";
            toast.error(msg ?? "Save failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => { if (!isOpen) { reset(); setOpen(false); } }}
        >
            <DialogContent
                className="max-w-2xl gap-0 p-0 sm:max-w-2xl"
                // Don't dismiss on click-outside — voucher entry is too easy to
                // lose to a stray click. User must explicitly hit Cancel / Close.
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
            >
                <DialogHeader className="border-b border-border px-5 py-3 pr-12">
                    <div className="flex items-center justify-between">
                        <DialogTitle>Contra</DialogTitle>
                        <span className="font-mono text-xs text-muted-foreground">
                            {nextRef || "Generating…"}
                        </span>
                    </div>
                </DialogHeader>

                {/* Date + Account outside ScrollArea so their dropdowns are never clipped */}
                <div className="relative z-30 space-y-3 px-5 pt-4 pb-2">
                    {/* ── Date row ── */}
                    <div className="flex items-center gap-3">
                        <Label className="w-16 shrink-0 text-xs">Date</Label>
                        <TallyDateInput
                            autoFocus
                            value={date}
                            onValueChange={setDate}
                            className="h-7 w-40 text-sm"
                        />
                    </div>

                    {/* ── Account (destination) ── */}
                    <div className="flex items-start gap-3">
                        <Label className="w-16 shrink-0 pt-1.5 text-xs">Account to deposit funds</Label>
                        <div className="flex-1">
                            <GlAccountCombobox
                                value={sourceId}
                                onChange={(a) => setSourceId(a?.id ?? null)}
                                accounts={cashBankAccounts}
                                placeholder="Bank Accounts / Cash-in-Hand…"
                            />
                            {sourceAccount && <BalanceHint account={sourceAccount} />}
                        </div>
                    </div>
                </div>

                <ScrollArea className="relative z-20 max-h-[50vh]">
                    <div className="space-y-0 px-5 pb-4">

                        {/* ── Particulars table — no overflow-hidden so dropdowns show above siblings ── */}
                        {/* No overflow-hidden here — it would clip the account combobox dropdowns */}
                        <div className="mt-3 rounded-md border border-border">
                            <table className="w-full text-sm">
                                <thead className="border-b border-border bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
                                    <tr>
                                        <th className="rounded-tl-md px-4 py-2 text-left font-medium">Particulars</th>
                                        <th className="w-36 px-4 py-2 text-right font-medium">Amount</th>
                                        <th className="w-8 rounded-tr-md px-2 py-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => {
                                        const acct = row.accountId ? accountById.get(row.accountId) : undefined;
                                        const sameAsSource = !!row.accountId && row.accountId === sourceId;
                                        return (
                                            <tr key={row.id} className="border-t border-border/60 align-top">
                                                <td className="relative px-4 py-2" style={{ zIndex: 30 }}>
                                                    <GlAccountCombobox
                                                        value={row.accountId}
                                                        onChange={(a) => updateRow(row.id, { accountId: a?.id ?? null })}
                                                        accounts={cashBankAccounts}
                                                        placeholder="Bank Accounts / Cash-in-Hand…"
                                                    />
                                                    {sameAsSource && (
                                                        <p className="mt-0.5 text-[11px] text-destructive">
                                                            Same as source account
                                                        </p>
                                                    )}
                                                    {acct && !sameAsSource && <BalanceHint account={acct} />}
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    <Input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={row.amount}
                                                        placeholder="0.00"
                                                        onChange={(e) => {
                                                            if (isAmountChars(e.target.value))
                                                                updateRow(row.id, { amount: e.target.value });
                                                        }}
                                                        className="h-7 text-right tabular-nums"
                                                    />
                                                </td>
                                                <td className="px-2 py-2 text-center">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon-xs"
                                                        disabled={rows.length <= 1}
                                                        onClick={() => removeRow(row.id)}
                                                        className="text-destructive/50 hover:text-destructive"
                                                        title="Remove row"
                                                    >
                                                        <Trash2 size={13} />
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot className="border-t border-border bg-muted/50 text-sm font-semibold">
                                    <tr>
                                        <td className="px-4 py-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={addRow}
                                                className="h-auto py-0.5 text-xs text-muted-foreground hover:text-foreground"
                                            >
                                                <Plus size={12} className="mr-1" /> Add row
                                            </Button>
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums">
                                            {total > 0 ? `₹ ${fmt(total)}` : "—"}
                                        </td>
                                        <td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* ── Narration ── */}
                        <div className="mt-4 space-y-1.5">
                            <Label className="text-xs">Narration</Label>
                            <Textarea
                                value={narration}
                                rows={2}
                                placeholder="e.g. Deposit from petty cash and safe into HDFC bank"
                                onChange={(e) => setNarration(e.target.value)}
                            />
                        </div>
                    </div>
                    <ScrollBar orientation="vertical" />
                </ScrollArea>

                <VoucherDialogFooter
                    saving={saving}
                    canSubmit={canSubmit}
                    onCancel={() => { reset(); setOpen(false); }}
                    onSaveDraft={() => submit(false)}
                    onSavePost={() => submit(true)}
                />
            </DialogContent>
        </Dialog>
    );
}
