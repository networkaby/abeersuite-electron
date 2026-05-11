"use client";

/**
 * Tally-style two-sided voucher dialog used by four voucher kinds:
 *
 *   PAYMENT      top = Cash / Bank (Cr — money out),  rows = parties / expenses (Dr)
 *   RECEIPT      top = Cash / Bank (Dr — money in),   rows = parties / income (Cr)
 *   CREDIT_NOTE  top = Customer / Sundry Debtor (Cr — balance down), rows = sales returns / discount (Dr)
 *   DEBIT_NOTE   top = Supplier / Sundry Creditor (Dr — balance down), rows = purchase returns / discount (Cr)
 *
 * Modes:
 *   • Single (default for all) — one top-account picker plus many
 *     particulars rows. Mirrors ContraDialog's UX: the top side equals the
 *     sum of particulars so the dialog auto-balances on every keystroke.
 *   • Multi — Payment / Receipt only. Many top rows AND many particulars
 *     rows, both totals must match. Use case: "cash 100 + bank 1500 paid
 *     to abc 500 + xyz 1100". Credit / debit notes are always single-party
 *     (one customer / one supplier), so the toggle is hidden for those.
 *
 * All four kinds post to /api/accountancy/vouchers with the corresponding
 * `type`. Per-kind labels, account filters, and Dr / Cr assignments live in
 * the COPY table below; the rest of the component is shape-shared.
 */

import { useEffect, useRef, useState } from "react";
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
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { GlAccountCombobox, type GlAccount } from "./GlAccountCombobox";
import { BalanceHint } from "./BalanceHint";
import { VoucherDialogFooter } from "./VoucherDialogFooter";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { usePaymentDialogStore } from "@/store/paymentDialogStore";
import { useReceiptDialogStore } from "@/store/receiptDialogStore";
import { useCreditNoteDialogStore } from "@/store/creditNoteDialogStore";
import { useDebitNoteDialogStore } from "@/store/debitNoteDialogStore";

type Kind = "PAYMENT" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE";
type Mode = "single" | "multi";

const CASH_BANK_GROUPS = [ACCOUNT_GROUPS.CASH_IN_HAND, ACCOUNT_GROUPS.BANK_ACCOUNTS] as const;
const isCashOrBank = (a: GlAccount) =>
    CASH_BANK_GROUPS.includes(a.group?.name as typeof CASH_BANK_GROUPS[number]);
const isSundryDebtor = (a: GlAccount) => a.group?.name === ACCOUNT_GROUPS.SUNDRY_DEBTORS;
const isSundryCreditor = (a: GlAccount) => a.group?.name === ACCOUNT_GROUPS.SUNDRY_CREDITORS;

type Row = {
    id: number;
    accountId: number | null;
    amount: string;
    note?: string;
};

let rowSeq = 0;
const newRow = (): Row => ({ id: ++rowSeq, accountId: null, amount: "" });

/**
 * Per-kind config. `top` = the singular Single-mode picker at the top
 * (and the column in Multi mode that has multiple of these). `row` = the
 * particulars table. The pair lays out the same data model for all four:
 *
 *   PAYMENT  top = cash/bank (Cr money out),  rows = parties / expenses (Dr)
 *   RECEIPT  top = cash/bank (Dr money in),   rows = parties / income (Cr)
 *   CREDIT_NOTE  top = customer (Cr balance down), rows = sales returns / discount (Dr)
 *   DEBIT_NOTE   top = supplier (Dr balance down), rows = purchase returns / income (Cr)
 */
const COPY: Record<Kind, {
    title: string;
    topLabel: string;
    topHeader: string;
    rowHeader: string;
    topPlaceholder: string;
    rowPlaceholder: string;
    narrationPlaceholder: string;
    topSide: "DEBIT" | "CREDIT";
    rowSide: "DEBIT" | "CREDIT";
    /** Filter callable on the loaded accounts. */
    topFilter: (a: GlAccount) => boolean;
    rowFilter: (a: GlAccount) => boolean;
}> = {
    PAYMENT: {
        title: "Payment",
        topLabel: "Paid from",
        topHeader: "Paid from",
        rowHeader: "Paid to",
        topPlaceholder: "Cash-in-Hand / Bank Accounts…",
        rowPlaceholder: "Party / expense / income…",
        narrationPlaceholder: "e.g. Office rent for March 2026",
        topSide: "CREDIT",
        rowSide: "DEBIT",
        topFilter: isCashOrBank,
        rowFilter: () => true,
    },
    RECEIPT: {
        title: "Receipt",
        topLabel: "Received in",
        topHeader: "Received in",
        rowHeader: "Received from",
        topPlaceholder: "Cash-in-Hand / Bank Accounts…",
        rowPlaceholder: "Party / expense / income…",
        narrationPlaceholder: "e.g. Cash received from abeer",
        topSide: "DEBIT",
        rowSide: "CREDIT",
        topFilter: isCashOrBank,
        rowFilter: () => true,
    },
    CREDIT_NOTE: {
        title: "Credit Note",
        topLabel: "Customer",
        topHeader: "Customer credited",
        rowHeader: "Against",
        topPlaceholder: "Customer / Sundry Debtor…",
        rowPlaceholder: "Sales Returns / Discount Allowed / …",
        narrationPlaceholder: "e.g. Sales return — damaged in transit",
        topSide: "CREDIT",
        rowSide: "DEBIT",
        topFilter: isSundryDebtor,
        rowFilter: () => true,
    },
    DEBIT_NOTE: {
        title: "Debit Note",
        topLabel: "Supplier",
        topHeader: "Supplier debited",
        rowHeader: "Against",
        topPlaceholder: "Supplier / Sundry Creditor…",
        rowPlaceholder: "Purchase Returns / Discount Received / …",
        narrationPlaceholder: "e.g. Purchase return — damaged goods to ACME",
        topSide: "DEBIT",
        rowSide: "CREDIT",
        topFilter: isSundryCreditor,
        rowFilter: () => true,
    },
};

export function MoneyFlowDialog({ kind }: { kind: Kind }) {
    const router = useRouter();
    const copy = COPY[kind];
    const paymentStore = usePaymentDialogStore();
    const receiptStore = useReceiptDialogStore();
    const creditNoteStore = useCreditNoteDialogStore();
    const debitNoteStore = useDebitNoteDialogStore();
    const { open, setOpen } =
        kind === "PAYMENT" ? paymentStore :
        kind === "RECEIPT" ? receiptStore :
        kind === "CREDIT_NOTE" ? creditNoteStore :
        debitNoteStore;

    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [nextRef, setNextRef] = useState("");
    const [saving, setSaving] = useState(false);
    // Credit / debit notes are always single-party — the toggle is hidden for
    // those kinds. Payment / Receipt keep both modes.
    const supportsMulti = kind === "PAYMENT" || kind === "RECEIPT";
    const [mode, setMode] = useState<Mode>("single");
    const activeMode: Mode = supportsMulti ? mode : "single";

    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [narration, setNarration] = useState("");

    // Single-mode state — one top-side account, many particulars rows.
    // PAY/REC: pick a Cash / Bank ledger via GlAccountCombobox (account id only).
    // CN/DN: pick a customer / supplier via PartySearchAndCreate — the same
    //        shared component POS + new-ticket use, so users can inline-create
    //        a brand-new party (with the "phone or email required" gate +
    //        inline server errors) from inside the voucher dialog.
    const [singleMoneyId, setSingleMoneyId] = useState<number | null>(null);
    const [singleParty, setSingleParty] = useState<PickedParty | null>(null);
    const partyPickerRef = useRef<PartySearchAndCreateHandle>(null);
    const isNoteKind = kind === "CREDIT_NOTE" || kind === "DEBIT_NOTE";
    const effectiveSingleId: number | null = isNoteKind ? (singleParty?.accountId ?? null) : singleMoneyId;
    const [partyRows, setPartyRows] = useState<Row[]>([newRow()]);

    // Multi-mode state — many money rows, many particulars rows.
    const [multiMoneyRows, setMultiMoneyRows] = useState<Row[]>([newRow()]);

    const accountById = new Map<number, GlAccount>(accounts.map((a) => [a.id, a]));
    const topAccounts = accounts.filter(copy.topFilter);
    const rowAccounts = accounts.filter(copy.rowFilter);
    const singleMoneyAccount = effectiveSingleId ? accountById.get(effectiveSingleId) : undefined;

    // Totals
    const partyTotal = partyRows.reduce((s, r) => s + parseAmount(r.amount), 0);
    const multiMoneyTotal = multiMoneyRows.reduce((s, r) => s + parseAmount(r.amount), 0);
    const moneyTotal = activeMode === "single" ? partyTotal : multiMoneyTotal;
    const balanced =
        activeMode === "single"
            ? partyTotal > 0
            : Math.abs(multiMoneyTotal - partyTotal) < 0.005 && partyTotal > 0;

    const canSubmit =
        balanced &&
        partyRows.every((r) => r.accountId && parseAmount(r.amount) > 0) &&
        (activeMode === "single"
            ? !!effectiveSingleId && partyRows.every((r) => r.accountId !== effectiveSingleId)
            : multiMoneyRows.every((r) => r.accountId && parseAmount(r.amount) > 0));

    const reset = () => {
        setMode("single");
        setSingleMoneyId(null);
        setSingleParty(null);
        partyPickerRef.current?.clear();
        setPartyRows([newRow()]);
        setMultiMoneyRows([newRow()]);
        setNarration("");
        setDate(new Date().toISOString().slice(0, 10));
    };

    useEffect(() => {
        if (!open) return;
        // includeParties=true so the particulars combobox can pick a party
        // ledger directly (Sundry Debtors / Creditors), not just GL accounts.
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=true")
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"));
        axios.get<{ reference: string }>(`/api/accountancy/vouchers/next-ref?type=${kind}`)
            .then((r) => setNextRef(r.data.reference))
            .catch(() => setNextRef(""));
    }, [open, kind]);

    const updateParty = (id: number, patch: Partial<Row>) =>
        setPartyRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const addParty = () => setPartyRows((rs) => [...rs, newRow()]);
    const removeParty = (id: number) =>
        setPartyRows((rs) => rs.length <= 1 ? rs : rs.filter((r) => r.id !== id));

    const updateMoney = (id: number, patch: Partial<Row>) =>
        setMultiMoneyRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const addMoney = () => setMultiMoneyRows((rs) => [...rs, newRow()]);
    const removeMoney = (id: number) =>
        setMultiMoneyRows((rs) => rs.length <= 1 ? rs : rs.filter((r) => r.id !== id));

    const submit = async (postAfterSave: boolean) => {
        if (!canSubmit) return;
        setSaving(true);
        try {
            const topLines = activeMode === "single"
                ? [{ accountId: effectiveSingleId!, type: copy.topSide, amount: partyTotal }]
                : multiMoneyRows.map((r) => ({
                    accountId: r.accountId!,
                    type: copy.topSide,
                    amount: parseAmount(r.amount),
                }));
            const rowLines = partyRows.map((r) => ({
                accountId: r.accountId!,
                type: copy.rowSide,
                amount: parseAmount(r.amount),
                description: r.note?.trim() || undefined,
            }));

            const created = await axios.post<{ id: number; reference: string }>("/api/accountancy/vouchers", {
                type: kind,
                date,
                narration: narration.trim() || undefined,
                lines: [...topLines, ...rowLines],
            });

            if (postAfterSave) {
                await axios.post(`/api/accountancy/vouchers/${created.data.id}/post`);
                toast.success(`${copy.title} ${created.data.reference} saved & posted`);
            } else {
                toast.success(`${copy.title} ${created.data.reference} saved as draft`);
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
                        <DialogTitle>{copy.title}</DialogTitle>
                        <div className="flex items-center gap-3">
                            {/* Mode toggle — only Payment / Receipt allow Multi mode.
                                Credit / debit notes are always single-party. */}
                            {supportsMulti && (
                                <div className="flex rounded-md border border-border bg-muted p-0.5 text-xs">
                                    {(["single", "multi"] as Mode[]).map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => setMode(m)}
                                            className={`rounded px-2 py-0.5 capitalize transition-colors ${
                                                mode === m
                                                    ? "bg-background font-medium text-foreground shadow"
                                                    : "text-muted-foreground hover:text-foreground"
                                            }`}
                                        >
                                            {m}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <span className="font-mono text-xs text-muted-foreground">
                                {nextRef || "Generating…"}
                            </span>
                        </div>
                    </div>
                </DialogHeader>

                {/* Date row + single-mode money picker — outside ScrollArea so dropdowns aren't clipped */}
                <div className="relative z-30 space-y-3 px-5 pt-4 pb-2">
                    <div className="flex items-center gap-3">
                        <Label className="w-16 shrink-0 text-xs">Date</Label>
                        <Input
                            type="date"
                            autoFocus
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="h-7 w-40 text-sm"
                        />
                    </div>

                    {activeMode === "single" && (
                        <div className="flex items-start gap-3">
                            <Label className="w-16 shrink-0 pt-1.5 text-xs">{copy.topLabel}</Label>
                            <div className="flex-1">
                                {isNoteKind ? (
                                    // CN / DN — pick a customer / supplier via the shared
                                    // search-and-create flow. Same UX users see in POS +
                                    // new-ticket: keyboard nav, "phone or email required"
                                    // gate, inline server errors. createUnderGroup pins
                                    // the auto-created ledger to the right party group.
                                    <PartySearchAndCreate
                                        ref={partyPickerRef}
                                        onPicked={setSingleParty}
                                        locked={!!singleParty}
                                        placeholder={copy.topPlaceholder}
                                        // CN → Sundry Debtors (customers); DN → Sundry Creditors
                                        // (suppliers). Both allow widening: a supplier who also
                                        // buys from us may need a CN, vice-versa for DN.
                                        partyGroup={kind === "CREDIT_NOTE"
                                            ? ACCOUNT_GROUPS.SUNDRY_DEBTORS
                                            : ACCOUNT_GROUPS.SUNDRY_CREDITORS}
                                        allowIncludeOther
                                    />
                                ) : (
                                    // PAY / REC — pick a Cash / Bank ledger.
                                    <GlAccountCombobox
                                        value={singleMoneyId}
                                        onChange={(a) => setSingleMoneyId(a?.id ?? null)}
                                        accounts={topAccounts}
                                        placeholder={copy.topPlaceholder}
                                    />
                                )}
                                {isNoteKind && singleParty && (
                                    <button
                                        type="button"
                                        onClick={() => { setSingleParty(null); partyPickerRef.current?.clear(); }}
                                        className="mt-1 text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                                    >
                                        Clear &times;
                                    </button>
                                )}
                                <BalanceHint account={singleMoneyAccount} />
                            </div>
                        </div>
                    )}
                </div>

                <ScrollArea className="relative z-20 max-h-[55vh]">
                    <div className="space-y-0 px-5 pb-4">

                        {/* Multi-mode: money-flow table appears above particulars */}
                        {activeMode === "multi" && (
                            <div className="mt-3 rounded-md border border-border">
                                <table className="w-full text-sm">
                                    <thead className="border-b border-border bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
                                        <tr>
                                            <th className="rounded-tl-md px-4 py-2 text-left font-medium">{copy.topHeader}</th>
                                            <th className="w-36 px-4 py-2 text-right font-medium">Amount</th>
                                            <th className="w-8 rounded-tr-md px-2 py-2" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {multiMoneyRows.map((row) => {
                                            const acct = row.accountId ? accountById.get(row.accountId) : undefined;
                                            return (
                                                <tr key={row.id} className="border-t border-border/60 align-top">
                                                    <td className="relative px-4 py-2" style={{ zIndex: 30 }}>
                                                        <GlAccountCombobox
                                                            value={row.accountId}
                                                            onChange={(a) => updateMoney(row.id, { accountId: a?.id ?? null })}
                                                            accounts={topAccounts}
                                                            placeholder={copy.topPlaceholder}
                                                        />
                                                        <BalanceHint account={acct} />
                                                    </td>
                                                    <td className="px-4 py-2 text-right">
                                                        <Input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={row.amount}
                                                            placeholder="0.00"
                                                            onChange={(e) => {
                                                                if (isAmountChars(e.target.value))
                                                                    updateMoney(row.id, { amount: e.target.value });
                                                            }}
                                                            className="h-7 text-right tabular-nums"
                                                        />
                                                    </td>
                                                    <td className="px-2 py-2 text-center">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon-xs"
                                                            disabled={multiMoneyRows.length <= 1}
                                                            onClick={() => removeMoney(row.id)}
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
                                                    onClick={addMoney}
                                                    className="h-auto py-0.5 text-xs text-muted-foreground hover:text-foreground"
                                                >
                                                    <Plus size={12} className="mr-1" /> Add row
                                                </Button>
                                            </td>
                                            <td className="px-4 py-2 text-right tabular-nums">
                                                {multiMoneyTotal > 0 ? `₹ ${fmt(multiMoneyTotal)}` : "—"}
                                            </td>
                                            <td />
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}

                        {/* Particulars table (both modes) */}
                        <div className="mt-3 rounded-md border border-border">
                            <table className="w-full text-sm">
                                <thead className="border-b border-border bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
                                    <tr>
                                        <th className="rounded-tl-md px-4 py-2 text-left font-medium">{copy.rowHeader}</th>
                                        <th className="w-36 px-4 py-2 text-right font-medium">Amount</th>
                                        <th className="w-8 rounded-tr-md px-2 py-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {partyRows.map((row) => {
                                        const acct = row.accountId ? accountById.get(row.accountId) : undefined;
                                        const sameAsSingleMoney = activeMode === "single" && !!row.accountId && row.accountId === effectiveSingleId;
                                        return (
                                            <tr key={row.id} className="border-t border-border/60 align-top">
                                                <td className="relative px-4 py-2" style={{ zIndex: 30 }}>
                                                    <GlAccountCombobox
                                                        value={row.accountId}
                                                        onChange={(a) => updateParty(row.id, { accountId: a?.id ?? null })}
                                                        accounts={rowAccounts}
                                                        placeholder={copy.rowPlaceholder}
                                                    />
                                                    {sameAsSingleMoney && (
                                                        <p className="mt-0.5 text-[11px] text-destructive">
                                                            Same as {copy.topLabel.toLowerCase()} account
                                                        </p>
                                                    )}
                                                    {acct && !sameAsSingleMoney && <BalanceHint account={acct} />}
                                                </td>
                                                <td className="px-4 py-2 text-right">
                                                    <Input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={row.amount}
                                                        placeholder="0.00"
                                                        onChange={(e) => {
                                                            if (isAmountChars(e.target.value))
                                                                updateParty(row.id, { amount: e.target.value });
                                                        }}
                                                        className="h-7 text-right tabular-nums"
                                                    />
                                                </td>
                                                <td className="px-2 py-2 text-center">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon-xs"
                                                        disabled={partyRows.length <= 1}
                                                        onClick={() => removeParty(row.id)}
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
                                                onClick={addParty}
                                                className="h-auto py-0.5 text-xs text-muted-foreground hover:text-foreground"
                                            >
                                                <Plus size={12} className="mr-1" /> Add row
                                            </Button>
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums">
                                            {partyTotal > 0 ? `₹ ${fmt(partyTotal)}` : "—"}
                                        </td>
                                        <td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* Balance status — only meaningful in multi mode */}
                        {activeMode === "multi" && (multiMoneyTotal > 0 || partyTotal > 0) && (
                            <div className={`mt-2 rounded-md border px-3 py-1.5 text-xs ${
                                balanced
                                    ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
                                    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                            }`}>
                                {balanced
                                    ? `Balanced — ${fmt(multiMoneyTotal)} on both sides`
                                    : `Out of balance — ${copy.topHeader} ${fmt(multiMoneyTotal)} vs ${copy.rowHeader} ${fmt(partyTotal)} (diff ${fmt(Math.abs(multiMoneyTotal - partyTotal))})`}
                            </div>
                        )}

                        {/* Narration */}
                        <div className="mt-4 space-y-1.5">
                            <Label className="text-xs">Narration</Label>
                            <Textarea
                                value={narration}
                                rows={2}
                                placeholder={copy.narrationPlaceholder}
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

/** Thin wrappers for layout mounting + module sidebar actions. */
export function PaymentDialog() { return <MoneyFlowDialog kind="PAYMENT" />; }
export function ReceiptDialog() { return <MoneyFlowDialog kind="RECEIPT" />; }
export function CreditNoteDialog() { return <MoneyFlowDialog kind="CREDIT_NOTE" />; }
export function DebitNoteDialog() { return <MoneyFlowDialog kind="DEBIT_NOTE" />; }
