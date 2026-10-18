"use client";

// Shared POS customer-display coordinator — the single source of truth for what
// the customer-facing DQ11 shows while a bill is being built. It was a byte-
// identical `useEffect` in PosScreen (Sale) and PosQuoteScreen (Order/Estimate);
// the effect body + dependency list are moved here verbatim, with every value it
// reads passed in as a named field. The post-submit finale (thank-you vs idle)
// and printing stay in each screen — only this live coordinator is shared.

import { useEffect } from "react";
import { qrDisplay } from "@/modules/pos/lib/qrDisplay";
import { computePriceLadder } from "@/modules/pos/lib/priceLadder";
import type { Snapshot, CartLine, ProductOption } from "@/modules/pos/lib/posDraftTypes";

export type PosCustomerDisplayParams = {
    /** Suppresses the coordinator while the green "Thank You ₹X" frame is held. */
    displayHold: "thankyou" | null;
    checkoutOpen: boolean;
    upiEntered: number;
    /** VPA of the counter's UPI account being collected into (null = none set). */
    upiVpa: string | null;
    /** Payee name shown above the pay QR (company-level). */
    upiPayeeName: string;
    /** Caption under the pay QR when the UPI is taken in parts ("Part 2 of 3 ·
     *  Pay ₹1,667 via UPI"). null = the plain "Pay ₹X via UPI". */
    upiCaption?: string | null;
    cashNet: number;
    splitsSum: number;
    payableTotal: number;
    collected: number;
    cart: CartLine[];
    /** The bill's own per-line figures (index-aligned with `cart`), after any
     *  customer-group rebate — so the ladder reconciles to `total`. */
    lineRows: { amount: number; taxAmount: number }[];
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
    /** Product Explorer hover — the cashier's mouse is resting on this tile, not
     *  yet added. Shown standalone ("Add this item?") so the customer sees and
     *  can agree to it before it lands on the bill. null = not hovering. */
    hoverPreview: ProductOption | null;
};

const FRAME_SETTLE_MS = 250;
const UPI_SETTLE_MS = 1000;

// Single source of truth for what the customer-facing DQ11 shows. Priority:
//   1. thank-you (held by displayHold after a successful sale)
//   2. UPI QR — checkout open and UPI amount entered
//   3. payment summary — checkout open with cash/extras entered
//   4. Explorer hover preview — cashier's mouse resting on a not-yet-added tile
//   5. cart — items in cart
//   6. customer welcome — customer picked, cart empty
//   7. idle slideshow — nothing else
// Debounced — the DQ11 takes ~3s to transmit a frame at 921600 baud, so
// rapid keystrokes would queue stale frames. Wait FRAME_SETTLE_MS after the
// last state change before pushing, and UPI_SETTLE_MS for the pay QR: a QR
// sent mid-typing is scannable (₹3 on screen while the cashier types ₹32).
// Fire-and-forget; relay-down never blocks POS.
export function usePosCustomerDisplay({
    displayHold, checkoutOpen, upiEntered, upiVpa, upiPayeeName, upiCaption,
    cashNet, splitsSum, payableTotal, collected,
    cart, lineRows, snapshot, subtotal, discountAmount, total, totalDiscount,
    effDiscountAmount, effRedemptionRupees, couponRupees, posExtraCharges, posTierLabel,
    hoverPreview,
}: PosCustomerDisplayParams) {
    useEffect(() => {
        if (displayHold === "thankyou") return;

        const showUpi = checkoutOpen && upiEntered > 0;
        const timer = setTimeout(() => {
            if (showUpi) {
                // VPA + payee come from the active counter (per-counter identity),
                // not a relay-side default. If the counter's UPI account has no VPA
                // set, the QR can't render a payee — fix it under Settings → Counters.
                void qrDisplay.upi({
                    amount: upiEntered,
                    vpa: upiVpa ?? undefined,
                    payeeName: upiPayeeName,
                    caption: upiCaption ?? `Pay ₹${upiEntered.toFixed(2)} via UPI`,
                });
            } else if (checkoutOpen && (cashNet > 0 || splitsSum > 0)) {
                void qrDisplay.payment({
                    total: payableTotal,
                    cashPaid: cashNet,
                    balance: Math.max(0, payableTotal - collected),
                });
            } else if (hoverPreview) {
                // Standalone single-item view (its own DQ11 screen, complete with
                // the shelf photo when there is one) — not on the bill yet, just
                // "does this look right?" before the cashier actually adds it.
                const price = hoverPreview.effectiveSalePricePaise != null ? hoverPreview.effectiveSalePricePaise / 100 : 0;
                const mrp = hoverPreview.mrpPaise != null ? hoverPreview.mrpPaise / 100 : undefined;
                void qrDisplay.product({
                    name: hoverPreview.name,
                    price,
                    mrp,
                    image: hoverPreview.imageUrl ?? undefined,
                });
            } else if (cart.length > 0) {
                // Customer-facing price ladder — same computed view as the receipt.
                const lr = lineRows;
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
        }, showUpi ? UPI_SETTLE_MS : FRAME_SETTLE_MS);

        return () => clearTimeout(timer);
        // Left out on purpose: lineRows / posExtraCharges are new arrays every render
        // (listing them would restart the debounce on every render and could starve
        // the display), and they, payableTotal and posTierLabel only move together
        // with cart / snapshot / total, which are listed. upiPayeeName is fixed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        displayHold, checkoutOpen, cart, snapshot,
        cashNet, upiEntered, upiVpa, upiCaption, splitsSum, collected,
        subtotal, discountAmount, total,
        totalDiscount, effDiscountAmount, effRedemptionRupees, couponRupees,
        hoverPreview,
    ]);
}
