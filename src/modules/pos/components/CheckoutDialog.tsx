"use client";

// ── CheckoutDialog ───────────────────────────────────────────────────────────
// The POS sale checkout modal: Total/Collected/On-credit header, Cash row, the
// multi-tender split picker (TenderSplitInput), Credit (auto-balanced) row, the
// overpayment panel, and the Confirm / Confirm+Print CTAs. Extracted from
// PosScreen as a presentational component — it owns NO business logic; all state
// + the confirm/share actions are passed in by the parent.

import React from "react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, ReceiptIndianRupee, CreditCard, AlertCircle } from "lucide-react";
import { type TenderSplit, type TenderAccount } from "@/modules/pos/components/TenderSplitInput";
import { TenderEntry } from "@/modules/pos/components/TenderEntry";

const fmtINR = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type PayState = { cashTendered: number; cashReturn: number };

export function CheckoutDialog({
    open, onOpenChange,
    total, collected, onCredit, payableTotal,
    overpaid, balanceDue, arrearPaid, advanceTaken,
    giftCardApplied, giftCardCode,
    creditLimitBreached, creditLimit,
    pay, setPay, cashTenderedRef,
    accounts, splits, setSplits,
    submitting, onConfirm, onShare,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    // Totals (all rupees)
    total: number;
    collected: number;
    onCredit: number;
    payableTotal: number;
    overpaid: number;
    balanceDue: number;
    arrearPaid: number;
    advanceTaken: number;
    // Gift card applied as a tender
    giftCardApplied: number;
    giftCardCode?: string | null;
    // Credit-limit guard
    creditLimitBreached: boolean;
    creditLimit: number | null;
    // Cash payment state
    pay: PayState;
    setPay: React.Dispatch<React.SetStateAction<PayState>>;
    cashTenderedRef: React.RefObject<HTMLInputElement | null>;
    // Non-cash tenders
    accounts: TenderAccount[];
    splits: TenderSplit[];
    setSplits: React.Dispatch<React.SetStateAction<TenderSplit[]>>;
    // Actions
    submitting: boolean;
    onConfirm: (printAfter: boolean) => void;
    onShare: (acct: TenderAccount) => void;
}) {
    // Enter on any amount field → confirm. Ctrl/Cmd+Enter → confirm + print.
    const enterToSubmit = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onConfirm(e.ctrlKey || e.metaKey);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Checkout · {fmtINR(total)}</DialogTitle>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-3 text-center text-sm">
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
                            <div className="font-semibold">{fmtINR(total)}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected</div>
                            <div className="font-semibold">{fmtINR(collected)}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">On credit</div>
                            <div className={`font-semibold ${onCredit > 0 ? "text-amber-600" : "text-emerald-600"}`}>{fmtINR(onCredit)}</div>
                        </div>
                    </div>

                    {giftCardApplied > 0.005 && (
                        <div className="flex items-center justify-between rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm dark:border-teal-500/30 dark:bg-teal-500/10">
                            <span className="flex items-center gap-1.5 text-teal-700 dark:text-teal-300"><CreditCard size={14} /> Gift card {giftCardCode} − {fmtINR(giftCardApplied)}</span>
                            <span className="font-semibold tabular-nums">Pay {fmtINR(payableTotal)}</span>
                        </div>
                    )}

                    {/* Credit limit warning — shown when on-credit portion would breach the limit */}
                    {creditLimitBreached && (
                        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" />
                            <span>
                                {creditLimit === 0
                                    ? "No credit facility — this account must be paid in full."
                                    : `Credit limit ₹${(creditLimit ?? 0).toLocaleString("en-IN")} exceeded. ` +
                                    `Outstanding ₹${balanceDue.toLocaleString("en-IN")}, ` +
                                    `this sale adds ₹${onCredit.toLocaleString("en-IN")} on credit.`
                                }
                            </span>
                        </div>
                    )}

                    <div className="space-y-2">
                        {/* Cash row + non-cash splits + Add-line — the shared tender body,
                            also reused by the Rcv dialog. targetTotal enables the cash
                            "fill remaining" helper and seeds new lines with the balance. */}
                        <TenderEntry
                            accounts={accounts}
                            splits={splits}
                            setSplits={setSplits}
                            pay={pay}
                            setPay={setPay}
                            cashTenderedRef={cashTenderedRef}
                            targetTotal={payableTotal}
                            onShare={onShare}
                            onEnter={enterToSubmit}
                        />

                        {/* Credit — readonly, auto-balanced */}
                        <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock size={12} /> Credit</Label>
                            <Input
                                value={onCredit ? onCredit.toFixed(2) : ""}
                                readOnly
                                tabIndex={-1}
                                placeholder="auto"
                                className="bg-muted/50 cursor-default text-right"
                                title="Auto-balanced — fill Cash / UPI / Card etc. and the rest goes on credit"
                            />
                        </div>
                        {/* Overpayment is collected on Confirm: the extra clears the oldest
                            open bills first (FIFO), and any leftover becomes a customer
                            advance — booked as a separate GST Receipt voucher so the bank/UPI
                            statement matches 1:1. */}
                        {(overpaid > 0 || balanceDue > 0) && (
                            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
                                {balanceDue > 0 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Existing dues</span>
                                        <span className="font-medium text-amber-600">{fmtINR(balanceDue)}</span>
                                    </div>
                                )}
                                {overpaid > 0 && (
                                    <>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Extra collected</span>
                                            <span className="font-medium text-foreground">{fmtINR(overpaid)}</span>
                                        </div>
                                        {arrearPaid > 0 && (
                                            <div className="flex items-center justify-between">
                                                <span className="text-muted-foreground">→ Clears old dues</span>
                                                <span className="font-medium text-emerald-600">{fmtINR(arrearPaid)}</span>
                                            </div>
                                        )}
                                        {advanceTaken > 0 && (
                                            <div className="flex items-center justify-between">
                                                <span className="text-muted-foreground">→ Advance / credit</span>
                                                <span className="font-medium text-emerald-600">{fmtINR(advanceTaken)}</span>
                                            </div>
                                        )}
                                        <p className="text-[11px] leading-snug text-muted-foreground">
                                            Confirm issues a Receipt voucher for the extra. Needs an identified customer (not a walk-in).
                                        </p>
                                    </>
                                )}
                                {overpaid <= 0 && balanceDue > 0 && (
                                    <p className="text-[11px] leading-snug text-muted-foreground">
                                        Collect dues by tendering more than the bill — the extra clears the oldest bills first.
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Inline confirm CTAs — final amount + actions sit close to the payment-line entry */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                            <Button onClick={() => onConfirm(false)} disabled={submitting || creditLimitBreached || onCredit > 0.01} size="lg" variant="outline"
                                title={onCredit > 0.01 ? "Collect the full bill amount to confirm (under-payment → use /sale for credit)" : overpaid > 0 ? "Extra is collected as a Receipt voucher — clears old dues first, leftover becomes advance" : undefined}>
                                <ReceiptIndianRupee size={16} /> {submitting ? "Saving…" : (overpaid > 0 ? "Confirm + collect" : "Confirm")}
                                <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">↵</span>
                            </Button>
                            <Button onClick={() => onConfirm(true)} disabled={submitting || creditLimitBreached || onCredit > 0.01} size="lg"
                                title={onCredit > 0.01 ? "Collect the full bill amount to confirm (under-payment → use /sale for credit)" : overpaid > 0 ? "Extra is collected as a Receipt voucher — clears old dues first, leftover becomes advance" : undefined}>
                                <ReceiptIndianRupee size={16} /> {submitting ? "Saving…" : "Confirm + Print"}
                                <span className="ml-2 rounded border border-border px-1.5 py-px text-[10px] opacity-80">Ctrl ↵</span>
                            </Button>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
