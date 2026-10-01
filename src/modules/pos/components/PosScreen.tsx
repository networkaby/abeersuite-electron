"use client";

// ── PosScreen (Sale) ──────────────────────────────────────────────────────────
// The POS Sale screen. All state + bill math + cart/coupon/gift-card/shift logic
// lives in the shared usePosBilling hook; the shared render tree lives in
// PosScreenShell. This file keeps only what is Sale-specific: the /api/pos/sale
// submit (with thermal printing + surplus Receipt handling), edit-mode hydration
// of a posted POS sale, and the checkout / share dialogs' wiring.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import axios from "axios";
import { toast } from "sonner";
import { ReceiptIndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaymentLinkDialog } from "@/modules/pos/components/PaymentLinkDialog";
import { CheckoutDialog } from "@/modules/pos/components/CheckoutDialog";
import { ClearBillDialog } from "@/modules/pos/components/ClearBillDialog";
import { PosScreenShell } from "@/modules/pos/components/PosScreenShell";
import { movesCash } from "@/modules/pos/components/TenderEntry";
import { usePosBilling, parseAmt } from "@/modules/pos/hooks/usePosBilling";
import { qrDisplay } from "@/modules/pos/lib/qrDisplay";
import { bridgeOk, bridgeRequest } from "@/shared/lib/bridge/hardwareBridge";
import { printVoucherThermal } from "@/shared/lib/print/silentThermalPrint";
import { computePriceLadder } from "@/modules/pos/lib/priceLadder";
import type { VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import type { VoucherBridgePayload } from "@/modules/accountancy/lib/voucherReceiptSample";
import { extractApiError } from "@/shared/lib/api";
import { formatInr, round2, todayIso, toDateOnly } from "@/shared/lib/format";
import { composeLineDescription, splitLineDescription } from "@/shared/lib/print/lineDescription";
import type { PartySearchAndCreateHandle } from "@/shared/components/PartySearchAndCreate";

// Charge rows carry taxAmount through the edit round-trip — POS-service rows
// are tax-bearing charges (Cr income net + Cr GST) and must re-post faithfully.
type EditMeta = { charges: { accountId: number; description?: string; amount: number; taxAmount?: number }[]; discountAmt: number; discountPct: number | null; shippingAmt: number; roundOff: number };

export default function PosScreen({ editId, fromId }: { editId?: number; fromId?: number }) {
    const router = useRouter();
    // Leaving an edit returns to the office Sales register — or the POS register, for a
    // cashier the page lock (pageAccess.ts) keeps out of the office one.
    const canOpen = useCanOpenPage();
    const salesListHref = canOpen("/office/accountancy/vouchers-registers/sales") ? "/office/accountancy/vouchers-registers/sales" : "/vouchers/pos";
    // Edit mode: reopen a posted POS sale here (instead of the office form, which
    // drops the POS-specific charge rows → wrong Balance Sheet). We hydrate only the
    // customer + cart; on save we PATCH the lines and RE-SEND the original
    // charges/discount while OMITTING tenders — so the payment + loyalty / coupon /
    // gift-card rows are preserved and the GL re-posts faithfully. A reduced total
    // over the unchanged payment lands as a credit on the customer's account.
    const isEdit = editId != null;
    // Convert-to-sale: source estimate/order id whose customer + cart pre-fill a
    // NEW sale; sent as sourceVoucherId on checkout so the source flips to "Converted".
    const convertFromRef = useRef<number | null>(null);
    const editMeta = useRef<EditMeta | null>(null);

    // Focus/handle refs — owned here, shared with the hook and the shell.
    const partySearchRef = useRef<PartySearchAndCreateHandle>(null);
    const productSearchRef = useRef<HTMLInputElement>(null);
    const cashTenderedRef = useRef<HTMLInputElement>(null);

    // Ctrl/Cmd+Enter → the checkout dialog: a new sale collects the money there;
    // an edit takes none, so it opens in "confirm" mode (Update Sale / Update &
    // Print Sale). (`b` is bound by the time the key handler can fire.)
    const b = usePosBilling({
        onHotkeyConfirm: () => {
            // Mirror the disabled Checkout button: silently no-op while a
            // require-note item still has a blank line note.
            if (!b.saleNoteMissing) b.openCheckout();
        },
        partySearchRef,
        productSearchRef,
        cashTenderedRef,
        // A new sale works the customer group's silent rebate into the bill; an
        // edit re-sends rates that already carry it.
        groupRebate: !isEdit,
    });

    // Which rail the share dialog opens locked to — set by the Share button on a
    // UPI/gateway payment-split row. (Sale-only; quote screens lock to "upi".)
    const [shareProvider, setShareProvider] = useState<string>("upi");

    // ── Edit mode: hydrate a posted POS sale on mount ───────────────────────────
    // Editing an existing voucher is NOT a carried draft: clear the shared draft on
    // entry (so a half-built new sale doesn't leak in) and again on exit (so the
    // edited voucher's lines don't leak into the next new sale).
    useEffect(() => {
        if (!isEdit) return;
        b.resetDraft();
        let cancelled = false;
        (async () => {
            try {
                const { data } = await axios.get<{
                    accountId: number | null; type: string; status: string;
                    discountAmt: string | number | null; discountPct: string | number | null;
                    shippingAmt: string | number | null; roundOff: string | number | null;
                    lines: { productId: number; description: string | null; quantity: string | number; rate: string | number; taxRate: string | number; mrpPaise: number | null; savedSalePricePaise: number | null; product: { sku: string; name: string } }[];
                    charges: { accountId: number; description: string | null; amount: string | number; taxAmount?: string | number | null }[];
                }>(`/api/inventory/vouchers/${editId}`);
                if (cancelled) return;
                if (data.type !== "POS" || data.status === "CANCELLED") {
                    toast.error("This POS sale can't be edited.");
                    router.push(salesListHref);
                    return;
                }
                // Preserve the original charges (incl. server-added loyalty / coupon /
                // gift-card rows) + discount / shipping / round-off — re-sent on save so
                // the total + GL stay faithful while the cashier only adjusts items.
                editMeta.current = {
                    charges: data.charges.map((c) => ({ accountId: c.accountId, description: c.description ?? undefined, amount: Number(c.amount), taxAmount: c.taxAmount != null ? Number(c.taxAmount) : undefined })),
                    discountAmt: data.discountAmt != null ? Number(data.discountAmt) : 0,
                    discountPct: data.discountPct != null ? Number(data.discountPct) : null,
                    shippingAmt: data.shippingAmt != null ? Number(data.shippingAmt) : 0,
                    roundOff: data.roundOff != null ? Number(data.roundOff) : 0,
                };
                if (data.accountId != null) await b.fetchSnapshot(data.accountId);
                if (cancelled) return;
                b.setCart(data.lines.map((l) => ({
                    productId: l.productId,
                    sku: l.product.sku,
                    name: l.product.name,
                    qty: Number(l.quantity),
                    unitPrice: Number(l.rate),
                    description: splitLineDescription(l.description, l.product).note ?? "",
                    taxRate: Number(l.taxRate),
                    mrpPaise: l.mrpPaise,
                    barcodePaise: l.savedSalePricePaise,
                })));
            } catch (e: unknown) {
                if (cancelled) return;
                toast.error(extractApiError(e, "Could not load the sale to edit"));
                router.push(salesListHref);
            }
        })();
        return () => { cancelled = true; b.resetDraft(); };
        // One-shot hydration keyed on the voucher id; the helpers it calls are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEdit, editId]);

    // ── Convert-to-sale: pre-load a source estimate/order into a NEW sale ───────
    // "Convert to POS Sale" opens the till pre-filled (customer + cart) so the
    // cashier reviews and rings it up. NOT edit mode — completing it creates a fresh
    // POS sale that links back (sourceVoucherId → refVoucherId), marking the source
    // "Converted".
    useEffect(() => {
        if (fromId == null || isEdit) return;
        b.resetDraft();
        let cancelled = false;
        (async () => {
            try {
                const { data } = await axios.get<{
                    accountId: number | null;
                    lines: { productId: number; description: string | null; quantity: string | number; rate: string | number; taxRate: string | number; mrpPaise: number | null; savedSalePricePaise: number | null; product: { sku: string; name: string } }[];
                }>(`/api/inventory/vouchers/${fromId}`);
                if (cancelled) return;
                convertFromRef.current = fromId;
                if (data.accountId != null) await b.fetchSnapshot(data.accountId);
                if (cancelled) return;
                b.setCart(data.lines.map((l) => ({
                    productId: l.productId,
                    sku: l.product.sku,
                    name: l.product.name,
                    qty: Number(l.quantity),
                    unitPrice: Number(l.rate),
                    description: splitLineDescription(l.description, l.product).note ?? "",
                    taxRate: Number(l.taxRate),
                    mrpPaise: l.mrpPaise,
                    barcodePaise: l.savedSalePricePaise,
                })));
                toast.message("Loaded from source — review and ring up to complete the conversion.");
            } catch (e: unknown) {
                if (cancelled) return;
                toast.error(extractApiError(e, "Could not load the document to convert"));
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromId, isEdit]);

    const generateInvoice = async (printAfter = false) => {
        const { snapshot, cart, lineRows, pay, splits, payAccountById } = b;
        if (!snapshot?.account) return;

        // ── Edit mode: PATCH the existing sale's lines, preserving payments + offers ──
        // Re-send the original charges + discount/shipping/round-off and OMIT tenders, so
        // the PATCH keeps the loyalty/coupon/gift-card + payment rows and re-posts the GL
        // faithfully. A reduced total over the unchanged payment becomes a customer
        // account credit. No tenders / loyalty / coupon flow on an edit; it prints
        // (like a register reprint) only when asked.
        if (isEdit && editMeta.current) {
            if (cart.length === 0) { toast.error("Cart is empty"); return; }
            if (cart.some((l) => l.unitPrice <= 0)) { toast.error("All lines need a unit price"); return; }
            b.setSubmitting(true);
            try {
                await axios.patch(`/api/inventory/vouchers/${editId}`, {
                    lines: cart.map((l) => ({
                        productId: l.productId,
                        description: composeLineDescription({ sku: l.sku, name: l.name, note: l.description }),
                        quantity: l.qty,
                        rate: l.unitPrice,
                        taxRate: l.taxRate,
                        mrpPaise: l.mrpPaise ?? undefined,
                    })),
                    charges: editMeta.current.charges,
                    discountAmt: editMeta.current.discountAmt,
                    discountPct: editMeta.current.discountPct ?? undefined,
                    shippingAmt: editMeta.current.shippingAmt,
                    roundOff: editMeta.current.roundOff,
                    // tenders deliberately omitted → preserved; the GL re-post reuses them.
                });
                toast.success("Sale updated");
                b.setCheckoutOpen(false);   // no second Enter while the page navigates away
                if (printAfter) await printVoucherThermal("inv", editId, "POS");
                router.push(salesListHref);
            } catch (e: unknown) {
                toast.error(extractApiError(e, "Failed to update sale"));
            } finally {
                b.setSubmitting(false);
            }
            return;
        }

        if (b.creditLimitBreached) return;   // guard against keyboard shortcut bypass
        // Build the summary from the named pay fields. Cash net = tendered − return.
        const summaryParts: string[] = [];
        if (b.cashNet > 0) {
            const tenderedNote = pay.cashReturn > 0 ? ` (₹${pay.cashTendered} − ₹${pay.cashReturn} return)` : "";
            summaryParts.push(`Cash ${formatInr(b.cashNet)}${tenderedNote}`);
        }
        for (const s of splits) {
            if (s.amount <= 0) continue;
            const label = payAccountById.get(s.paymentAccountId ?? -1)?.label ?? "Payment";
            summaryParts.push(`${label} ${formatInr(s.amount)}${s.reference ? ` (${s.reference})` : ""}`);
        }
        if (b.onCredit > 0) summaryParts.push(`On credit ${formatInr(b.onCredit)}`);
        // Nothing tendered AND nothing on credit means a gift card covered the
        // whole bill (payableTotal is 0). Not an error — this string is only the
        // note the cashier reads back; the voucher's tender rows carry the truth.
        // It used to be refused here, because the server demanded one payment row.
        if (summaryParts.length === 0) {
            summaryParts.push(b.giftCardApplied > 0.005 ? `Gift card ${formatInr(b.giftCardApplied)}` : "No payment");
        }
        if (!b.activeShift) {
            toast.error("Open a shift before billing");
            b.setShiftOpenDialogOpen(true);
            return;
        }
        b.setSubmitting(true);
        try {
            // LOCAL calendar day — `toISOString()` shifts to UTC first, which
            // before 05:30 IST would stamp the sale (issueDate, below) with
            // YESTERDAY's date.
            const today = todayIso();
            const due = new Date(); due.setDate(due.getDate() + 30);
            const splitSummary = summaryParts.join(" + ");
            const tail =
                b.advanceTaken > 0 ? ` | Advance ${formatInr(b.advanceTaken)}` :
                    b.arrearPaid > 0 ? ` | Cleared arrear ${formatInr(b.arrearPaid)}` :
                        "";

            // Build the payments array. Each non-cash line carries the chosen
            // counter paymentAccountId; the server resolves its ledger + method
            // (set under /office/admin/counters). CASH (paymentAccountId null)
            // auto-routes to the till.
            type PayLine = { paymentAccountId: number | null; amount: number; reference?: string };
            const paymentsList: PayLine[] = [];
            if (b.cashNet > 0) paymentsList.push({ paymentAccountId: null, amount: b.cashNet });
            for (const s of splits) {
                if (s.amount <= 0) continue;
                paymentsList.push({ paymentAccountId: s.paymentAccountId, amount: s.amount, reference: s.reference || undefined });
            }
            // Under-pay (including collecting nothing at all) IS allowed: the
            // shortfall goes on the customer's account. The credit limit is the
            // only gate, and it is checked twice — `b.creditLimitBreached` above
            // for the cashier, and checkCreditLimit on the server for the truth.
            // Over-pay IS allowed when collecting surplus: the server books the
            // extra as a separate Receipt voucher (clears oldest dues FIFO, any
            // leftover = customer advance) so the bank/UPI statement matches 1:1.

            const validCharges = b.charges.filter((c) => c.accountId !== null && Math.abs(parseAmt(c.amount)) >= 0.005);
            const { data } = await axios.post<{ voucherId: number; voucherRef: string; pointsEarned: number; pointsRedeemed: number; milestoneBonus: number; milestoneCoupons: string[]; loyaltyBalance: number; couponDiscount: number; couponCode: string | null; freeCouponId: number | null; freeCouponCode: string | null; freeItems: { productId: number; freeQty: number; productName: string }[]; posTemplate: VoucherTemplateDefaults; receiptPrint: VoucherBridgePayload | null; surplusCollected: number; arrearCleared: number; advanceCredited: number; receiptVoucherId: number | null; receiptVoucherRef: string | null; partyBalance: { before: string; after: string } | null }>("/api/pos/sale", {
                accountId: snapshot.account.id,
                issueDate: today,
                dueDate: toDateOnly(due),   // local day, same reason as `today`
                notes: `POS sale (discount ${b.discountPct}%${b.effRedeemPts > 0 ? `, ${b.effRedeemPts} pts redeemed` : ""}${b.appliedCoupon ? `, coupon ${b.appliedCoupon.code ?? b.appliedCoupon.name}` : ""}) | Payments: ${splitSummary}${tail}`,
                lines: cart.filter((l) => l.kind !== "service").map((l) => ({
                    productId: l.productId,
                    description: composeLineDescription({ sku: l.sku, name: l.name, note: l.description }),
                    quantity: l.qty,
                    unitPrice: l.unitPrice,
                    taxRate: l.taxRate,
                    // Snapshots for the customer-facing "Today's discount" ladder.
                    mrpPaise: l.mrpPaise ?? null,
                    savedSalePricePaise: l.barcodePaise ?? null,
                })),
                // POS-service lines (cart kind="service", productId = −serviceId).
                // The server re-resolves each service's income ledger + GST rate
                // and posts them GL-only (no stock) as tax-bearing charge legs.
                services: cart.filter((l) => l.kind === "service").map((l) => ({
                    serviceId: -l.productId,
                    description: l.description.trim() || undefined,
                    quantity: l.qty,
                    unitPrice: l.unitPrice,
                })),
                payments: paymentsList,
                shippingAmt: b.shippingAmt,
                roundOff: b.roundOff,
                discountAmt: b.discountAmount,   // tier discount → server drops it if a non-stackable coupon applies
                discountPct: b.discountAmount > 0 ? b.discountPct : 0,  // tier % → stored so the receipt can name "Level Discount (Gold)"
                redeemPoints: b.effRedeemPts,     // 0 when a non-stackable coupon blocks loyalty
                couponCode: b.appliedCoupon?.code ?? undefined, // server re-resolves + owns the ₹ value
                // A force-applied AUTO offer has no code — carry its id instead.
                couponId: b.appliedCoupon && !b.appliedCoupon.code ? b.appliedCoupon.couponId : undefined,
                autoApply: !b.appliedCoupon && !!b.autoCoupon,     // let the server pick the best auto offer
                // Independent free-grant coupon — server derives the zero-price
                // free lines (stock + COGS move; the bill math doesn't change).
                freeCouponCode: b.appliedFree?.code ?? undefined,
                // Force-applied AUTO free-grant — no code, carry its id.
                freeCouponId: b.appliedFree && !b.appliedFree.code ? b.appliedFree.couponId : undefined,
                // No-code AUTO free-grant offer (independent FREE_ITEM / BOGO) —
                // the server re-selects it from the cart, so the free item lands
                // on the invoice even if the preview went stale.
                freeAutoApply: !b.appliedFree && !!b.autoFree,
                giftCardCode: b.giftCard?.code ?? undefined,     // server draws min(balance, total) as a tender
                collectSurplus: b.overpaid > 0.01,               // accept extra → Receipt voucher (clears dues FIFO, leftover = advance)
                sourceVoucherId: convertFromRef.current ?? undefined,   // convert-to-sale link → source flips to "Converted"
                ticketId: b.ticketId ?? undefined,               // repair-ticket link → bill shows on the ticket + timeline
                charges: validCharges.map((c) => ({
                    accountId: c.accountId as number,
                    description: c.description.trim() || undefined,
                    amount: parseAmt(c.amount),
                })),
            });
            const ptsMsg = data.pointsEarned > 0 ? ` · +${data.pointsEarned} pts (bal ${data.loyaltyBalance})`
                : data.pointsRedeemed > 0 ? ` · ${data.pointsRedeemed} pts redeemed (bal ${data.loyaltyBalance})`
                    : "";
            const bonusMsg = data.milestoneBonus > 0 ? ` 🏆 +${data.milestoneBonus} milestone bonus!` : "";
            const couponMsg = data.couponDiscount > 0 ? ` · coupon − ${formatInr(data.couponDiscount)}` : "";
            const freeMsg = data.freeItems?.length
                ? ` · 🎁 ${data.freeItems.map((f) => `${f.freeQty}×${f.productName}`).join(", ")} FREE`
                : "";
            const gcCouponMsg = data.milestoneCoupons?.length ? ` 🎟 coupon ${data.milestoneCoupons.join(", ")} issued!` : "";
            let surplusMsg = "";
            if (data.surplusCollected > 0) {
                const parts: string[] = [];
                if (data.arrearCleared > 0) parts.push(`cleared dues ${formatInr(data.arrearCleared)}`);
                if (data.advanceCredited > 0) parts.push(`advance ${formatInr(data.advanceCredited)}`);
                surplusMsg = ` · ${data.receiptVoucherRef ?? "Receipt"} +${formatInr(data.surplusCollected)}${parts.length ? ` (${parts.join(", ")})` : ""}`;
            }
            toast.success(`Invoice ${data.voucherRef} · ${formatInr(b.total)}${couponMsg}${freeMsg}${ptsMsg}${bonusMsg}${gcCouponMsg}${surplusMsg}`);
            // Show "Thank You ₹X" on the customer display and hold it so the
            // coordinator doesn't immediately overwrite it as state resets.
            void qrDisplay.thankyou({ amount: b.total });
            b.setDisplayHold("thankyou");
            setTimeout(() => b.setDisplayHold(null), 4500);
            b.resetAfterSubmit();
            convertFromRef.current = null;   // conversion completed
            if (printAfter) {
                if (await bridgeOk("thermal", 1000)) {
                    // Customer "Today's discount" ladder for the thermal slip (B
                    // density). Additive — the external relay renders these new
                    // fields; older relays ignore them.
                    const printLadder = computePriceLadder({
                        lines: cart.map((l, i) => ({
                            description: l.name,
                            qty: l.qty,
                            mrpPaise: l.mrpPaise,
                            barcodePaise: l.barcodePaise,
                            taxRatePct: l.taxRate,
                            taxAmount: lineRows[i]?.taxAmount ?? 0,
                            amount: lineRows[i]?.amount ?? l.qty * l.unitPrice,
                        })),
                        tierDiscount: b.effDiscountAmount,
                        loyaltyDiscount: b.effRedemptionRupees,
                        couponDiscount: b.couponRupees,
                        extraCharges: b.posExtraCharges,
                        total: b.total,
                    }, { tier: b.posTierLabel });
                    void bridgeRequest("thermal", "print/pos", {
                        invoiceNumber: data.voucherRef,
                        date: today,
                        customerName: snapshot?.party.name ?? "Walk-in",
                        customerPhone: snapshot?.party.phone ?? null,
                        customerGstin: snapshot?.party.gstin ?? null,
                        // Resolved POS print template → the relay renders the
                        // header/address/toggles/terms/footer + ladder so the
                        // printed slip matches /receipt/invoice/[id]?kind=POS.
                        template: data.posTemplate,
                        lines: cart.map((l, i) => {
                            // Per-unit tag from the ladder (single source of truth) so the
                            // MRP-fallback hides the real price even with no barcode. The
                            // relay multiplies by qty to rebuild the line total.
                            const ll = printLadder.lines[i];
                            // The bill's own pre-tax line value — after any customer-
                            // group rebate, which is never printed as its own row.
                            const gross = lineRows[i]?.gross ?? l.qty * l.unitPrice;
                            return {
                                name: l.name,
                                // Serial no. / colour typed in the line's Note box.
                                note: l.description.trim() || null,
                                qty: l.qty,
                                unitPrice: l.qty ? gross / l.qty : l.unitPrice,
                                amount: gross,
                                mrp: ll?.mrp != null && l.qty ? ll.mrp / l.qty : null,
                                barcode: ll?.barcode != null && l.qty ? ll.barcode / l.qty : null,
                            };
                        }),
                        subtotal: b.subtotal,
                        discountPct: b.discountPct,
                        discountAmount: b.discountAmount,
                        tax: b.tax,
                        total: b.total,
                        // Overpayment: the tenders live on the separate Receipt
                        // voucher (RV-…), so the sale slip shows only that
                        // receipt's link to the bill — the one row the reprint
                        // prints for it (`billSettlementPrint`). Exact-pay sales
                        // print one row per tender ledger, same as the preview /
                        // reprint (`sample.receipts`).
                        receipts: b.overpaid > 0
                            ? [{ label: data.receiptVoucherRef ? `Payment adjusted (${data.receiptVoucherRef})` : "Payment adjusted", amount: b.total }]
                            : [
                                ...(b.cashNet > 0 ? [{ label: "Cash", amount: b.cashNet }] : []),
                                ...splits
                                    .filter((s) => s.amount > 0)
                                    .map((s) => ({ label: payAccountById.get(s.paymentAccountId ?? -1)?.label ?? "Payment", amount: s.amount })),
                            ],
                        // What the counter did not collect rides the customer's
                        // account — printed as Balance due, same as the reprint.
                        // An overpaid bill is settled by its RV-…, so owes nothing.
                        balanceDue: b.overpaid <= 0 && b.onCredit > 0.01 ? round2(b.onCredit) : null,
                        // Previous / Closing balance — the sale API sends them only
                        // when the template's Party balance toggle is on.
                        balanceBefore: data.partyBalance?.before ?? null,
                        balanceAfter:  data.partyBalance?.after ?? null,
                        // "Today's discount" ladder (additive).
                        grossAtTag: printLadder.barcodeTotal,
                        discounts: printLadder.discounts.map((d) => ({ label: d.label, amount: d.amount })),
                        charges: printLadder.charges.map((c) => ({ label: c.label, amount: c.amount })),
                        savings: printLadder.savingsTotal > 0 ? { amount: printLadder.savingsTotal, pct: printLadder.savingsPct } : null,
                        hsnSummary: printLadder.hsn,
                        // Total GST embedded in the bill (goods + shipping/tax-bearing
                        // charges) — additive field, older relays ignore it.
                        taxTotal: printLadder.taxTotal,
                        // Cash taken → the slip opens the drawer (if this PC has one).
                        openDrawer: movesCash(pay),
                    }).catch(() => toast.error("Thermal print failed"));
                    // Overpayment booked a separate Receipt voucher (RV-…). On a
                    // relay setup it prints on the SAME thermal printer — the tender
                    // breakdown lives here, not on the sale slip above. The drawer
                    // already opened with the sale slip, so this one never asks.
                    if (data.receiptPrint) {
                        void bridgeRequest("thermal", "print/voucher", data.receiptPrint)
                            .catch(() => toast.error("Receipt voucher print failed"));
                    }
                } else {
                    // No thermal printer → the format-selection page (opens on the
                    // 80mm view; the cashier picks the format + printer and prints).
                    window.open(`/receipt/invoice/${data.voucherId}?kind=POS&paper=THERMAL_80MM&autoprint=0`, "_blank", "noopener");
                    if (data.receiptVoucherId) {
                        window.open(`/receipt/voucher/gl/${data.receiptVoucherId}?paper=THERMAL_80MM&autoprint=0`, "_blank", "noopener");
                    }
                }
            }
        } catch (e: unknown) {
            toast.error(extractApiError(e, "Failed to generate invoice"));
        } finally {
            b.setSubmitting(false);
        }
    };

    return (
        <PosScreenShell
            b={b}
            headerClass="border-emerald-300 bg-emerald-100/70 dark:border-emerald-900 dark:bg-emerald-950/30"
            active="sale"
            partySearchRef={partySearchRef}
            productSearchRef={productSearchRef}
            checkoutSlot={

                <Button
                    onClick={() => b.openCheckout()}
                    disabled={
                        b.cart.length === 0 ||
                        !b.snapshot?.account ||
                        b.submitting ||
                        b.saleNoteMissing
                    }
                    className="h-12 w-full text-base"
                    size="lg"
                >
                    {/* <div className="grid w-full grid-cols-3 items-center"> */}
                    {/* Left spacer */}
                    {/* <div /> */}

                    {/* Center */}
                    <div className="flex justify-between gap-3">
                        <div className="flex items-center justify-center gap-2">
                            <ReceiptIndianRupee size={18} />
                            <span>{isEdit ? "Update Sale" : "Checkout"}</span>
                            <span className="rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">
                                Ctrl ↵
                            </span>
                        </div>

                        {/* Right */}


                        <div className="justify-self-end flex items-center gap-2">
                            <span className="text-sm font-bold">Grand Total:</span>
                            <span className="rounded-lg border border-white/50 bg-white px-3 py-1 font-bold tabular-nums text-blue-600 shadow-sm">
                                {formatInr(b.total)}
                            </span>
                        </div>
                    </div>
                    {/* <div /> */}
                    {/* </div> */}
                </Button>




            }
        >
            {/* Share a UPI payment link + QR with the customer (collect remotely /
                in-store scan). Defaults to the balance still on credit. */}
            <PaymentLinkDialog
                open={b.shareOpen}
                onOpenChange={b.setShareOpen}
                defaultAmount={b.onCredit > 0.01 ? b.onCredit : b.total}
                partyName={b.snapshot?.party.name}
                partyPhone={b.snapshot?.party.phone ?? null}
                upiVpa={b.shareVpa}
                lockedProviderId={shareProvider}
            />

            {/* ── Checkout dialog — fixed Cash / UPI / Credit rows; an edit takes no
                money, so it opens in "confirm" mode (title + the two CTAs). ──── */}
            <CheckoutDialog
                mode={isEdit ? "confirm" : "sale"}
                title={isEdit ? `Update Sale · ${formatInr(b.total)}` : undefined}
                confirmLabel={isEdit ? "Update Sale" : undefined}
                confirmPrintLabel={isEdit ? "Update & Print Sale" : undefined}
                open={b.checkoutOpen}
                onOpenChange={b.setCheckoutOpen}
                total={b.total}
                collected={b.collected}
                onCredit={b.onCredit}
                payableTotal={b.payableTotal}
                overpaid={b.overpaid}
                balanceDue={b.balanceDue}
                ledgerBalance={b.ledgerBalance}
                arrearPaid={b.arrearPaid}
                advanceTaken={b.advanceTaken}
                giftCardApplied={b.giftCardApplied}
                giftCardCode={b.giftCard?.code}
                creditLimitBreached={b.creditLimitBreached}
                creditLimit={b.snapshot?.creditLimit ?? null}
                pay={b.pay}
                setPay={b.setPay}
                cashTenderedRef={cashTenderedRef}
                accounts={b.payAccounts}
                splits={b.splits}
                setSplits={b.setSplits}
                submitting={b.submitting}
                onConfirm={generateInvoice}
                onShare={(a) => { setShareProvider("upi"); b.setShareVpa(a.vpa); b.setShareOpen(true); }}
            />

            {/* ── Mid-bill clear confirmation (Shift+Esc) ────────────────────── */}
            <ClearBillDialog
                open={b.clearCartDialogOpen}
                onOpenChange={b.setClearCartDialogOpen}
                onConfirm={b.clearBill}
            />
        </PosScreenShell>
    );
}
