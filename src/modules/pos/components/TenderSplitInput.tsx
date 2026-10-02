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

export type TenderSplit = {
    id: string;
    paymentAccountId: number | null;
    amount: number;
    reference: string;
    /** UPI on a splitting method: take it as ONE payment anyway (carries MDR). */
    oneGo?: boolean;
    /** UPI parts the cashier has ticked as received, in order (0 = none yet). */
    received?: number;
};
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
    accounts, value, onChange, onShare, includeCash = false, onEnter, onFill, partsOf, canSplit,
}: {
    accounts: TenderAccount[];
    value: TenderSplit[];
    onChange: (v: TenderSplit[]) => void;
    /** When provided, UPI/gateway rows show a Share button instead of the ref
     *  input. `amount` is set when the row is taken in parts — the part due now. */
    onShare?: (acct: TenderAccount, amount?: number) => void;
    /** Add a "Cash (drawer)" option (paymentAccountId = null) to the picker. */
    includeCash?: boolean;
    onEnter?: (e: React.KeyboardEvent) => void;
    /** When provided, each row shows a ✓ that fills it with the remaining unpaid
     *  balance (same helper as the Cash row). Omitted where there is no bill total. */
    onFill?: (s: TenderSplit) => void;
    /** The payments a row is taken as (paymentMdr.ts) — more than one = UPI parts,
     *  shown under the row with a "received" tick each. Omitted = no parts. */
    partsOf?: (s: TenderSplit) => number[];
    /** Whether a row's method would split it — offers "Split" on a one-payment row. */
    canSplit?: (s: TenderSplit) => boolean;
}) {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const patch = (id: string, p: Partial<TenderSplit>) => onChange(value.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const remove = (id: string) => onChange(value.filter((x) => x.id !== id));

    return (
        <>
            {value.map((s) => {
                const acct = s.paymentAccountId == null ? null : byId.get(s.paymentAccountId);
                const canShare = !!onShare && !!acct?.vpa && (acct.channel === "UPI" || acct.channel === "GATEWAY");
                const parts = partsOf?.(s) ?? [];
                const inParts = parts.length > 1;
                const received = inParts ? Math.min(s.received ?? 0, parts.length) : 0;
                // Once a part is in, the amount is fixed — the parts already paid
                // were cut from it.
                const locked = received > 0;
                return (
                    <React.Fragment key={s.id}>
                    <div className="grid grid-cols-[170px_1fr_1fr_auto] items-center gap-2">
                        <Select
                            value={s.paymentAccountId == null ? CASH : String(s.paymentAccountId)}
                            disabled={locked}
                            onValueChange={(v) => patch(s.id, { paymentAccountId: v === CASH ? null : Number(v), received: 0 })}
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
                            {onFill && !locked && (
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
                                readOnly={locked}
                                title={locked ? "Parts already received — undo them to change the amount" : undefined}
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
                                onClick={() => onShare!(acct!, inParts && received < parts.length ? parts[received] : undefined)}
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
                        <Button variant="ghost" size="icon-sm" onClick={() => remove(s.id)} title="Remove" disabled={locked}>
                            <Trash2 size={12} className="text-destructive" />
                        </Button>
                    </div>
                    {inParts && (
                        <TenderParts
                            parts={parts}
                            received={received}
                            onReceived={(n) => patch(s.id, { received: n })}
                            onOneGo={() => patch(s.id, { oneGo: true, received: 0 })}
                        />
                    )}
                    {!inParts && s.oneGo && canSplit?.({ ...s, oneGo: false }) && (
                        <div className="pl-[178px] text-[11px] text-muted-foreground">
                            One UPI payment — the bank&apos;s charge applies.{" "}
                            <button
                                type="button"
                                className="font-medium text-primary underline-offset-2 hover:underline"
                                onClick={() => patch(s.id, { oneGo: false, received: 0 })}
                            >
                                Split into parts
                            </button>
                        </div>
                    )}
                    </React.Fragment>
                );
            })}
        </>
    );
}

/// The parts a UPI row is taken in, under the row: each part's amount, the one due
/// now highlighted (the customer display shows its QR), a tick for each part as
/// the money comes in, Undo, and "One payment" before anything is received.
function TenderParts({ parts, received, onReceived, onOneGo }: {
    parts: number[];
    received: number;
    onReceived: (n: number) => void;
    onOneGo: () => void;
}) {
    const done = received >= parts.length;
    return (
        <div className="space-y-1 pl-[178px]">
            <div className="flex flex-wrap gap-1">
                {parts.map((p, i) => (
                    <span
                        key={i}
                        className={`rounded border px-1.5 py-0.5 text-[11px] tabular-nums ${
                            i < received
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                                : i === received
                                  ? "border-primary bg-primary/10 font-semibold text-foreground"
                                  : "border-border text-muted-foreground"
                        }`}
                    >
                        {i < received && <Check size={10} className="mr-0.5 inline" />}
                        {i + 1}/{parts.length} · ₹{p.toLocaleString("en-IN")}
                    </span>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                {!done && (
                    <Button type="button" size="sm" className="h-7 text-xs" onClick={() => onReceived(received + 1)}>
                        <Check size={12} /> Part {received + 1} received
                    </Button>
                )}
                {received > 0 && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onReceived(received - 1)}>
                        Undo
                    </Button>
                )}
                {received === 0 && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onOneGo}>
                        One payment
                    </Button>
                )}
                <span className="text-[11px] text-muted-foreground">
                    {done ? "All parts received." : `Customer scans part ${received + 1} of ${parts.length}.`}
                </span>
            </div>
        </div>
    );
}
