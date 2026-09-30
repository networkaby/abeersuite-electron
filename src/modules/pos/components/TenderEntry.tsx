"use client";

// ── TenderEntry ──────────────────────────────────────────────────────────────
// The shared "how the money came in" block: a dedicated Cash row (tendered +
// change-back) + the non-cash split rows (TenderSplitInput, each with a Share QR)
// + "Add payment line" + an optional running Total. It owns NO bill/credit/sale
// logic — the checkout wraps it with sale chrome (totals header, gift card,
// overpayment, Confirm) and the Rcv dialog wraps it with receipt chrome (party,
// note, Record). Pass `targetTotal` (the bill) to enable the cash "fill remaining"
// helper; omit it (Rcv) and the tenders simply define their own total.

import React from "react";
import { Banknote, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    TenderSplitInput, TenderAmountInput, seedTenderSplit, type TenderSplit, type TenderAccount,
} from "@/modules/pos/components/TenderSplitInput";
import { formatInr } from "@/shared/lib/format";

export type PayState = { cashTendered: number; cashReturn: number };

/** Paper money changed hands — notes taken in or change given back. The slip for
 *  such a sale / receipt opens the cash drawer; a UPI- or card-only one does not. */
export const movesCash = (pay: PayState): boolean => pay.cashTendered > 0.005 || pay.cashReturn > 0.005;

export function TenderEntry({
    accounts, splits, setSplits,
    pay, setPay, cashTenderedRef,
    targetTotal, showTotal = false,
    onShare, onEnter,
}: {
    accounts: TenderAccount[];
    splits: TenderSplit[];
    setSplits: React.Dispatch<React.SetStateAction<TenderSplit[]>>;
    pay: PayState;
    setPay: React.Dispatch<React.SetStateAction<PayState>>;
    cashTenderedRef?: React.RefObject<HTMLInputElement | null>;
    /** The bill total, when there is one (checkout). Enables the cash "fill
     *  remaining" helper and seeds new lines with the unpaid balance. */
    targetTotal?: number;
    /** Show a "Total" strip (Rcv — where the tenders define the total). */
    showTotal?: boolean;
    onShare?: (acct: TenderAccount) => void;
    onEnter?: (e: React.KeyboardEvent) => void;
}) {
    const cashNet = Math.max(0, pay.cashTendered - pay.cashReturn);
    const splitsSum = splits.reduce((s, x) => s + x.amount, 0);
    const total = cashNet + splitsSum;

    // Per-split "fill remaining" — sets THIS line to the unpaid balance
    // (bill − cash − every OTHER split). Only offered when there is a bill total
    // (checkout); the Rcv dialog omits it, since tenders define their own total.
    const fillSplit = targetTotal != null
        ? (s: TenderSplit) => {
            const others = cashNet + (splitsSum - s.amount);
            const remaining = Math.max(0, +(targetTotal - others).toFixed(2));
            setSplits((prev) => prev.map((x) => (x.id === s.id ? { ...x, amount: remaining } : x)));
        }
        : undefined;

    return (
        <div className="space-y-2">
            {/* Cash — tendered + change-back on one row, net-cash hint below. */}
            <div className="grid grid-cols-[80px_1fr_auto_1fr] items-center gap-2">
                <Label className="flex items-center gap-1 text-xs">
                    <Banknote size={12} /> Cash
                    {targetTotal != null && (
                        <button
                            type="button"
                            title="Fill remaining amount in cash"
                            onClick={() => {
                                const remaining = Math.max(0, +(targetTotal - splitsSum).toFixed(2));
                                setPay((s) => ({ ...s, cashTendered: remaining, cashReturn: 0 }));
                                setTimeout(() => cashTenderedRef?.current?.select(), 0);
                            }}
                            className="ml-0.5 rounded-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 p-0.5 transition-colors"
                        >
                            <Check size={11} strokeWidth={2.5} />
                        </button>
                    )}
                </Label>
                <TenderAmountInput
                    ref={cashTenderedRef}
                    amount={pay.cashTendered}
                    onAmount={(cashTendered) => setPay((s) => ({ ...s, cashTendered }))}
                    data-tender-field
                    data-tender-amount
                    onKeyDown={onEnter}
                    placeholder="₹ tendered"
                    className="text-right"
                />
                <Label className="flex items-center gap-1 text-[10px] text-muted-foreground">return</Label>
                <TenderAmountInput
                    amount={pay.cashReturn}
                    onAmount={(cashReturn) => setPay((s) => ({ ...s, cashReturn }))}
                    data-tender-field
                    onKeyDown={onEnter}
                    placeholder="₹ change back"
                    className="text-right"
                />
            </div>
            {pay.cashReturn > 0 && (
                <div className="pl-[88px] text-[11px] text-muted-foreground">
                    net cash {formatInr(cashNet)} = ₹{pay.cashTendered} − ₹{pay.cashReturn} return
                </div>
            )}

            {/* Non-cash payment splits — each picks a counter payment account
                (UPI 1 → HDFC, UPI 2 → SBI, Card…); UPI/gateway rows show a Share QR. */}
            <TenderSplitInput
                accounts={accounts}
                value={splits}
                onChange={setSplits}
                onShare={onShare}
                onEnter={onEnter}
                onFill={fillSplit}
            />

            <div className="flex items-center justify-between gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={accounts.length === 0}
                    title={accounts.length === 0 ? "This counter only accepts Cash. Add payment accounts under /office/admin/counters." : undefined}
                    onClick={() => {
                        if (accounts.length === 0) return;
                        const remaining = targetTotal != null ? Math.max(0, +(targetTotal - total).toFixed(2)) : 0;
                        setSplits((prev) => [...prev, seedTenderSplit(accounts, remaining)]);
                    }}
                >
                    <Plus size={14} /> Add payment line
                </Button>
                {showTotal && <span className="text-sm font-semibold">Total {formatInr(total)}</span>}
            </div>
        </div>
    );
}
