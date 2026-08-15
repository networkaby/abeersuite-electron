"use client";

// Shared POS customer-display coordinator — the single source of truth for what
// the customer-facing DQ11 shows while a bill is being built. It was a byte-
// identical `useEffect` in PosScreen (Sale) and PosQuoteScreen (Order/Estimate);
// the effect body + dependency list are moved here verbatim, with every value it
// reads passed in as a named field. The post-submit finale (thank-you vs idle)
// and printing stay in each screen — only this live coordinator is shared.

import { useEffect } from "react";
import { calcLineTotals } from "@/modules/inventory/lib/stock";
import { qrDisplay } from "@/modules/pos/lib/qrDisplay";
import { computePriceLadder } from "@/modules/pos/lib/priceLadder";
import type { Snapshot, CartLine } from "@/modules/pos/lib/posDraftTypes";

export type PosCustomerDisplayParams = {
    /** Suppresses the coordinator while the green "Thank You ₹X" frame is held. */
    displayHold: "thankyou" | null;
    checkoutOpen: boolean;
    upiEntered: number;
    /** VPA of the counter's UPI account being collected into (null = none set). */
    upiVpa: string | null;
    /** Payee name shown above the pay QR (company-level). */
    upiPayeeName: string;
    cashNet: number;
    splitsSum: number;
    payableTotal: number;
    collected: number;
    cart: CartLine[];
    snapshot: Snapshot | null;
    subtotal: number;
    discountAmount: number;
    total: number;
    totalDiscount: number;
    effDiscountAmount: number;
    effRedemptionRupees: number;
    couponRupees: number;
    posExtraCharges: { label: string; amount: number; taxAmount?: number }[];
    posTierLabel: string | undefined;
};

// Single source of truth for what the customer-facing DQ11 shows. Priority:
//   1. thank-you (held by displayHold after a successful sale)
//   2. UPI QR — checkout open and UPI amount entered
//   3. payment summary — checkout open with cash/extras entered
//   4. cart — items in cart
//   5. customer welcome — customer picked, cart empty
//   6. idle slideshow — nothing else
// Debounced — the DQ11 takes ~3s to transmit a frame at 921600 baud, so
// rapid keystrokes (typing/clearing UPI amount) would queue stale frames.
// Wait 250ms after the last state change before pushing.
// Fire-and-forget; relay-down never blocks POS.
export function usePosCustomerDisplay({
    displayHold, checkoutOpen, upiEntered, upiVpa, upiPayeeName,
    cashNet, splitsSum, payableTotal, collected,
    cart, snapshot, subtotal, discountAmount, total, totalDiscount,
    effDiscountAmount, effRedemptionRupees, couponRupees, posExtraCharges, posTierLabel,
}: PosCustomerDisplayParams) {
    useEffect(() => {
        if (displayHold === "thankyou") return;

        const timer = setTimeout(() => {
            if (checkoutOpen && upiEntered > 0) {
                // VPA + payee come from the active counter (per-counter identity),
                // not a relay-side default. If the counter's UPI account has no VPA
                // set, the QR can't render a payee — fix it under Settings → Counters.
                void qrDisplay.upi({
                    amount: upiEntered,
                    vpa: upiVpa ?? undefined,
                    payeeName: upiPayeeName,
                    caption: `Pay ₹${upiEntered.toFixed(2)} via UPI`,
                });
            } else if (checkoutOpen && (cashNet > 0 || splitsSum > 0)) {
                void qrDisplay.payment({
                    total: payableTotal,
                    cashPaid: cashNet,
                    balance: Math.max(0, payableTotal - collected),
                });
            } else if (cart.length > 0) {
                // Customer-facing price ladder — same computed view as the receipt.
                const lr = cart.map((l) => calcLineTotals({ quantity: l.qty, rate: l.unitPrice, discountPct: 0, discountAmt: 0, taxRate: l.taxRate }));
                const lad = computePriceLadder({
                    lines: cart.map((l, i) => ({
                        description: l.name,
                        qty: l.qty,
                        mrpPaise: l.mrpPaise,
                        barcodePaise: l.barcodePaise,
                        taxRatePct: l.taxRate,
                        taxAmount: lr[i].taxAmount,
                        amount: lr[i].amount,
                    })),
                    tierDiscount: effDiscountAmount,
                    loyaltyDiscount: effRedemptionRupees,
                    couponDiscount: couponRupees,
                    extraCharges: posExtraCharges,
                    total,
                }, { tier: posTierLabel });
                void qrDisplay.cart({
                    items: cart.map((l, i) => {
                        // Per-unit tag from the ladder so the MRP-fallback hides the
                        // real price on the display too. Relay multiplies by qty.
                        const ll = lad.lines[i];
                        return {
                            name: l.name,
                            qty: l.qty,
                            price: l.unitPrice,
                            mrp: ll?.mrp != null && l.qty ? ll.mrp / l.qty : undefined,
                            barcode: ll?.barcode != null && l.qty ? ll.barcode / l.qty : undefined,
                        };
                    }),
                    subtotal,
                    discount: totalDiscount,
                    total,
                    discounts: lad.discounts.map((d) => ({ label: d.label, amount: d.amount })),
                    charges: lad.charges.map((c) => ({ label: c.label, amount: c.amount })),
                    gst: lad.taxTotal > 0 ? lad.taxTotal : undefined,
                    savings: lad.savingsTotal > 0 ? { amount: lad.savingsTotal, pct: lad.savingsPct } : undefined,
                });
            } else if (snapshot) {
                void qrDisplay.customer({
                    name: snapshot.party.name,
                    level: snapshot.customerLevel,
                    loyaltyPoints: snapshot.loyaltyPoints,
                    lastVisitAt: snapshot.lastVisitAt,
                    discountPct: snapshot.discountPct,
                    balanceDue: snapshot.balanceDue,
                });
            } else {
                void qrDisplay.idle();
            }
        }, 250);

        return () => clearTimeout(timer);
        // Dependency list kept identical to the original inline effect (some values
        // are intentionally read-latest via closure — see the exhaustive-deps note
        // that rode with it in both screens).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        displayHold, checkoutOpen, cart, snapshot,
        cashNet, upiEntered, upiVpa, splitsSum, collected,
        subtotal, discountAmount, total,
        totalDiscount, effDiscountAmount, effRedemptionRupees, couponRupees,
    ]);
}
