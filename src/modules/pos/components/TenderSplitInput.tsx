"use client";

// Shared multi-tender split rows — pick a counter payment account (+ optionally
// Cash) and an amount per line, with a per-account Share QR. Reused by the POS
// checkout (PosScreen / PosQuoteScreen) and the Receive-from-party dialog. Renders
// ONLY the rows; the parent keeps its own "Add payment line" button (use
// `seedTenderSplit` for a fresh row) so each screen controls its own layout.

import React from "react";
import { Smartphone, CreditCard, FileText, Building2, Wallet, Banknote, QrCode, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { parseDecimalInput } from "@/shared/lib/format";

/// Rupee box for a tender row. Binds a number but shows what the cashier typed,
/// so "32." and "32.50" survive the trip through Number(). A change from outside
/// — ✓ / "/" fill, F10, a reset — no longer matches the typed number and
/// replaces the text, even while the box has focus (why not NumericInput,
/// which holds its draft until blur).
export function TenderAmountInput({ amount, onAmount, ...rest }: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
    amount: number;
    onAmount: (amount: number) => void;
}) {
    const [draft, setDraft] = React.useState(amount ? String(amount) : "");
    if ((Number(draft) || 0) !== amount) setDraft(amount ? String(amount) : "");
    return (
        <Input
            inputMode="decimal"
            {...rest}
            type="text"
            value={draft}
            onChange={(e) => {
                const next = parseDecimalInput(e.target.value);
                setDraft(next);
                onAmount(Number(next) || 0);
            }}
        />
    );
}

export type TenderSplit = { id: string; paymentAccountId: number | null; amount: number; reference: string };
export type TenderAccount = { id: number; channel: string; label: string; vpa: string | null; defaultVisible?: boolean };

const CHANNEL_ICON: Record<string, React.ReactNode> = {
    UPI:           <Smartphone size={14} />,
    CARD:          <CreditCard size={14} />,
    CHEQUE:        <FileText size={14} />,
    WALLET:        <Wallet size={14} />,
    BANK_TRANSFER: <Building2 size={14} />,
    GATEWAY:       <CreditCard size={14} />,
};

const CASH = "cash";

/// A fresh split row, seeded to the first account (or Cash when included / no
/// accounts) and the remaining amount.
export function seedTenderSplit(accounts: TenderAccount[], remaining = 0, includeCash = false): TenderSplit {
    const first = accounts[0]?.id ?? null;
    return {
        id: crypto.randomUUID(),
        paymentAccountId: first == null && includeCash ? null : first,
        amount: remaining > 0 ? remaining : 0,
        reference: "",
    };
}

export function TenderSplitInput({
    accounts, value, onChange, onShare, includeCash = false, onEnter, onFill,
}: {
    accounts: TenderAccount[];
    value: TenderSplit[];
    onChange: (v: TenderSplit[]) => void;
    /** When provided, UPI/gateway rows show a Share button instead of the ref input. */
    onShare?: (acct: TenderAccount) => void;
    /** Add a "Cash (drawer)" option (paymentAccountId = null) to the picker. */
    includeCash?: boolean;
    onEnter?: (e: React.KeyboardEvent) => void;
    /** When provided, each row shows a ✓ that fills it with the remaining unpaid
     *  balance (same helper as the Cash row). Omitted where there is no bill total. */
    onFill?: (s: TenderSplit) => void;
}) {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const patch = (id: string, p: Partial<TenderSplit>) => onChange(value.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const remove = (id: string) => onChange(value.filter((x) => x.id !== id));

    return (
        <>
            {value.map((s) => {
                const acct = s.paymentAccountId == null ? null : byId.get(s.paymentAccountId);
                const canShare = !!onShare && !!acct?.vpa && (acct.channel === "UPI" || acct.channel === "GATEWAY");
                return (
                    <div key={s.id} className="grid grid-cols-[170px_1fr_1fr_auto] items-center gap-2">
                        <Select
                            value={s.paymentAccountId == null ? CASH : String(s.paymentAccountId)}
                            onValueChange={(v) => patch(s.id, { paymentAccountId: v === CASH ? null : Number(v) })}
                        >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {includeCash && (
                                    <SelectItem value={CASH}>
                                        <span className="flex items-center gap-2"><Banknote size={14} /> Cash (drawer)</span>
                                    </SelectItem>
                                )}
                                {accounts.map((a) => (
                                    <SelectItem key={a.id} value={String(a.id)}>
                                        <span className="flex items-center gap-2">{CHANNEL_ICON[a.channel]} {a.label}</span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1">
                            {onFill && (
                                <button
                                    type="button"
                                    title="Fill remaining amount here"
                                    onClick={() => onFill(s)}
                                    className="shrink-0 rounded-full p-0.5 text-emerald-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40"
                                >
                                    <Check size={11} strokeWidth={2.5} />
                                </button>
                            )}
                            <TenderAmountInput
                                amount={s.amount}
                                onAmount={(amount) => patch(s.id, { amount })}
                                data-tender-field
                                data-tender-amount
                                data-tender-split={s.id}
                                onKeyDown={onEnter}
                                placeholder="₹ amount"
                                className="text-right"
                            />
                        </div>
                        {canShare ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                title={`Share ${acct?.label} QR with the customer`}
                                onClick={() => onShare!(acct!)}
                            >
                                <QrCode size={14} /> Share
                            </Button>
                        ) : (
                            <Input
                                value={s.reference}
                                data-tender-field
                                data-tender-split={s.id}
                                onChange={(ev) => patch(s.id, { reference: ev.target.value })}
                                onKeyDown={onEnter}
                                placeholder="Ref / last-4"
                            />
                        )}
                        <Button variant="ghost" size="icon-sm" onClick={() => remove(s.id)} title="Remove">
                            <Trash2 size={12} className="text-destructive" />
                        </Button>
                    </div>
                );
            })}
        </>
    );
}
