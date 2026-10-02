"use client";

// ── CheckoutDialog ───────────────────────────────────────────────────────────
// The POS checkout modal: Total/Collected/On-credit header, Cash row, the
// multi-tender split picker (TenderSplitInput), Credit (auto-balanced) row, the
// overpayment panel, and the Confirm / Confirm+Print CTAs. Extracted from
// PosScreen as a presentational component — it owns NO business logic; all state
// + the confirm/share actions are passed in by the parent.
//
// `mode` adapts the same body to three sites:
//   "sale"   (default) — collecting AGAINST a bill: an under-payment goes on the
//                        customer's account (Confirm blocked only when it would
//                        breach their credit limit), overpayment → Receipt panel.
//   "order"  — collecting an OPTIONAL advance on a POS order: no credit-limit
//              block, partial/zero advance is fine, "Save Order" CTAs. The sale
//              path renders byte-identically to before when mode is omitted.
//   "receipt"— receiving money with NO bill (the "Rcv" button): no totals header /
//              gift-card / credit / overpayment. The parent passes a party picker
//              as `topSlot` and a note field as `bottomSlot`; the tenders define
//              the total; CTAs read "Record receipt" / "Record + Print".
//   "confirm"— a save with NO money: the Estimate, and an Order / Estimate
//              edit. Only the title and the two CTAs; the caller names them.
//              The dialog itself takes Enter / Ctrl+Enter (no amount field to
//              hang them on), so it confirms exactly like the Sale.
//
// `sidePanel` opens beside the body, widening the dialog to the right instead of
// covering it — the UPI-in-parts panel (UpiPartsPanel), so the cashier can still
// move money between the rows while the customer scans.

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
import { SavePrintButtons, savePrintKey } from "@/modules/pos/components/SavePrintButtons";
import { formatInr } from "@/shared/lib/format";

type PayState = { cashTendered: number; cashReturn: number };

export function CheckoutDialog({
    open, onOpenChange,
    mode = "sale",
    total, collected = 0, onCredit = 0, payableTotal = 0,
    overpaid = 0, balanceDue = 0, ledgerBalance = 0, arrearPaid = 0, advanceTaken = 0,
    giftCardApplied = 0, giftCardCode,
    creditLimitBreached = false, creditLimit = null,
    pay, setPay, cashTenderedRef,
    accounts, splits, setSplits,
    submitting, onConfirm, onShare,
    topSlot, bottomSlot, confirmDisabled = false,
    title, confirmLabel, confirmPrintLabel,
    fillAmountFor, sidePanel,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    mode?: "sale" | "order" | "receipt" | "confirm";
    // Totals (all rupees). For "receipt" the bill-only fields are unused.
    total: number;
    collected?: number;
    onCredit?: number;
    payableTotal?: number;
    overpaid?: number;
    balanceDue?: number;
    /** Signed ledger balance — negative means the customer is in credit. `balanceDue`
     *  clamps that to 0, which would otherwise print "Outstanding ₹0" for a customer
     *  who is actually holding an advance. */
    ledgerBalance?: number;
    arrearPaid?: number;
    advanceTaken?: number;
    // Gift card applied as a tender
    giftCardApplied?: number;
    giftCardCode?: string | null;
    // Credit-limit guard
    creditLimitBreached?: boolean;
    creditLimit?: number | null;
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
    onShare?: (acct: TenderAccount, row: TenderSplit) => void;
    // "receipt" mode chrome — a party picker above the tenders and a note below.
    topSlot?: React.ReactNode;
    bottomSlot?: React.ReactNode;
    confirmDisabled?: boolean;
    // "confirm" mode names its own title and CTAs (the others derive them).
    title?: string;
    confirmLabel?: string;
    confirmPrintLabel?: string;
    /** The amount a row needs to settle the bill when the bill moves with it
     *  (payment-method MDR — usePosBilling). Absent = bill − everything else. */
    fillAmountFor?: (s: TenderSplit) => number;
    /** Opens beside the body (the dialog widens to the right) — never over it. */
    sidePanel?: React.ReactNode;
}) {
    const isSale = mode === "sale";
    const isOrder = mode === "order";
    const isReceipt = mode === "receipt";
    const isConfirm = mode === "confirm";
    // Sale allows an under-payment: whatever is not collected goes on the
    // customer's account, up to their credit limit. Only a BREACH of that limit
    // blocks Confirm. An order advance / a receipt are optional in amount, so
    // only `submitting` (+ a parent-supplied guard) gates them.
    const confirmBlocked = submitting || confirmDisabled || (isSale && creditLimitBreached);
    const underpayTitle = isConfirm ? undefined
        : isSale && onCredit > 0.01
            ? `${formatInr(onCredit)} goes on the customer's account — they owe it after this bill`
            : overpaid > 0 ? "Extra is collected as a Receipt voucher — clears old dues first, leftover becomes advance" : undefined;

    // Enter on any amount field → confirm. Ctrl/Cmd+Enter → confirm + print.
    const enterToSubmit = (e: React.KeyboardEvent) => savePrintKey(e, onConfirm, { disabled: confirmBlocked });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                // With the side panel the dialog grows to the RIGHT: its left edge
                // stays where the plain checkout's was (half of max-w-lg left of
                // centre), pulled back only when the screen is too narrow for both.
                className={sidePanel
                    ? "sm:left-[clamp(1rem,calc(50%-16rem),calc(100%-55rem))] sm:max-w-[min(54rem,calc(100%-2rem))] sm:translate-x-0"
                    : "sm:max-w-lg"}
                // No amount field in "confirm" mode — the dialog takes the keys.
                onKeyDown={isConfirm ? enterToSubmit : undefined}
            >
                <DialogHeader>
                    <DialogTitle>
                        {title ?? (isReceipt ? "Receive from party" : isOrder ? `Save Order · ${formatInr(total)}` : `Checkout · ${formatInr(total)}`)}
                        {isOrder && <span className="text-sm font-normal text-muted-foreground"> — advance optional</span>}
                    </DialogTitle>
                </DialogHeader>

                <div className={sidePanel ? "grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_19rem]" : undefined}>
                <div className="space-y-3">
                    {/* Receipt: the party picker sits where the bill header would be. */}
                    {isReceipt && topSlot}

                    {!isReceipt && !isConfirm && (
                    <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-3 text-center text-sm">
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
                            <div className="font-semibold">{formatInr(total)}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected</div>
                            <div className="font-semibold">{formatInr(collected)}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">On credit</div>
                            <div className={`font-semibold ${onCredit > 0 ? "text-amber-600" : "text-emerald-600"}`}>{formatInr(onCredit)}</div>
                        </div>
                    </div>
                    )}

                    {!isReceipt && !isConfirm && giftCardApplied > 0.005 && (
                        <div className="flex items-center justify-between rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm dark:border-teal-500/30 dark:bg-teal-500/10">
                            <span className="flex items-center gap-1.5 text-teal-700 dark:text-teal-300"><CreditCard size={14} /> Gift card {giftCardCode} − {formatInr(giftCardApplied)}</span>
                            <span className="font-semibold tabular-nums">Pay {formatInr(payableTotal)}</span>
                        </div>
                    )}

                    {/* Sale: credit-limit warning when the on-credit portion would breach the limit. */}
                    {isSale && creditLimitBreached && (
                        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" />
                            <span>
                                {creditLimit == null || creditLimit === 0
                                    ? "No credit facility on this account — collect the full amount."
                                    : `Credit limit ₹${creditLimit.toLocaleString("en-IN")} exceeded. ` +
                                    (ledgerBalance < 0
                                        ? `In credit ₹${Math.abs(ledgerBalance).toLocaleString("en-IN")}, `
                                        : `Outstanding ₹${ledgerBalance.toLocaleString("en-IN")}, `) +
                                    `this sale adds ₹${onCredit.toLocaleString("en-IN")} on credit.`
                                }
                            </span>
                        </div>
                    )}

                    {/* Order: advance is optional — no credit-limit block. */}
                    {isOrder && (
                        <div className="flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span>Advance is optional — leave the amounts blank to book the order with no payment. Any amount collected posts a separate Receipt voucher on the customer&apos;s account.</span>
                        </div>
                    )}

                    <div className="space-y-2">
                        {/* Cash row + non-cash splits + Add-line — the shared tender body,
                            also reused by the Rcv dialog. targetTotal (bill) enables the
                            cash "fill remaining" helper; receipt omits it (tenders define
                            the total, so it shows its own running Total instead). */}
                        {!isConfirm && (
                        <TenderEntry
                            accounts={accounts}
                            splits={splits}
                            setSplits={setSplits}
                            pay={pay}
                            setPay={setPay}
                            cashTenderedRef={cashTenderedRef}
                            targetTotal={isReceipt ? undefined : payableTotal}
                            showTotal={isReceipt}
                            onShare={onShare}
                            onEnter={enterToSubmit}
                            fillAmountFor={fillAmountFor}
                        />
                        )}

                        {/* Credit — readonly, auto-balanced (bill modes only) */}
                        {!isReceipt && !isConfirm && (
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
                        )}

                        {/* Receipt: optional note sits where the credit row would be. */}
                        {isReceipt && bottomSlot}

                        {/* Overpayment is collected on Confirm: the extra clears the oldest
                            open bills first (FIFO), and any leftover becomes a customer
                            advance — booked as a separate GST Receipt voucher so the bank/UPI
                            statement matches 1:1. (Sale only — an order advance can't exceed
                            the total, so there's nothing to overpay.) */}
                        {isSale && (overpaid > 0 || balanceDue > 0) && (
                            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
                                {balanceDue > 0 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Existing dues</span>
                                        <span className="font-medium text-amber-600">{formatInr(balanceDue)}</span>
                                    </div>
                                )}
                                {overpaid > 0 && (
                                    <>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Extra collected</span>
                                            <span className="font-medium text-foreground">{formatInr(overpaid)}</span>
                                        </div>
                                        {arrearPaid > 0 && (
                                            <div className="flex items-center justify-between">
                                                <span className="text-muted-foreground">→ Clears old dues</span>
                                                <span className="font-medium text-emerald-600">{formatInr(arrearPaid)}</span>
                                            </div>
                                        )}
                                        {advanceTaken > 0 && (
                                            <div className="flex items-center justify-between">
                                                <span className="text-muted-foreground">→ Advance / credit</span>
                                                <span className="font-medium text-emerald-600">{formatInr(advanceTaken)}</span>
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
                        <SavePrintButtons
                            className="pt-1"
                            size="lg"
                            icon={<ReceiptIndianRupee size={16} />}
                            label={confirmLabel ?? (isReceipt ? "Record receipt" : isOrder ? "Save Order" : overpaid > 0 ? "Confirm + collect" : "Confirm")}
                            printLabel={confirmPrintLabel ?? (isReceipt ? "Record + Print" : isOrder ? "Save + Print" : "Confirm + Print")}
                            onSave={onConfirm}
                            disabled={confirmBlocked}
                            submitting={submitting}
                            title={underpayTitle}
                        />
                    </div>
                </div>
                {sidePanel}
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
