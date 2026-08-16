"use client";

// ── PosScreen (Sale) ──────────────────────────────────────────────────────────
// The POS Sale screen. All state + bill math + cart/coupon/gift-card/shift logic
// lives in the shared usePosBilling hook; the shared render tree lives in
// PosScreenShell. This file keeps only what is Sale-specific: the /api/pos/sale
// submit (with thermal printing + surplus Receipt handling), edit-mode hydration
// of a posted POS sale, and the checkout / share dialogs' wiring.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ReceiptIndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaymentLinkDialog } from "@/modules/pos/components/PaymentLinkDialog";
import { CheckoutDialog } from "@/modules/pos/components/CheckoutDialog";
import { PosScreenShell } from "@/modules/pos/components/PosScreenShell";
import { usePosBilling, parseAmt } from "@/modules/pos/hooks/usePosBilling";
import { qrDisplay } from "@/modules/pos/lib/qrDisplay";
import { computePriceLadder } from "@/modules/pos/lib/priceLadder";
import type { VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { extractApiError } from "@/shared/lib/api";
import { formatInr, todayIso, toDateOnly } from "@/shared/lib/format";
import type { PartySearchAndCreateHandle } from "@/shared/components/PartySearchAndCreate";

// Charge rows carry taxAmount through the edit round-trip — POS-service rows
// are tax-bearing charges (Cr income net + Cr GST) and must re-post faithfully.
type EditMeta = { charges: { accountId: number; description?: string; amount: number; taxAmount?: number }[]; discountAmt: number; discountPct: number | null; shippingAmt: number; roundOff: number };

export default function PosScreen({ editId, fromId }: { editId?: number; fromId?: number }) {
    const router = useRouter();
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

    // Ctrl/Cmd+Enter → editing PATCHes directly (no checkout); a new sale opens
    // the checkout dialog. (`b` and `generateInvoice` are bound by the time the
    // key handler can fire.)
    const b = usePosBilling({
        onHotkeyConfirm: () => {
            if (isEdit) void generateInvoice(false);
            // Mirror the disabled Checkout button: silently no-op while a
            // require-note item still has a blank line note.
            else if (!b.saleNoteMissing) b.openCheckout();
        },
        partySearchRef,
        productSearchRef,
        cashTenderedRef,
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
                    accountId: number | null; type: string; status: string; deletedAt: string | null;
                    discountAmt: string | number | null; discountPct: string | number | null;
                    shippingAmt: string | number | null; roundOff: string | number | null;
                    lines: { productId: number; description: string | null; quantity: string | number; rate: string | number; taxRate: string | number; mrpPaise: number | null; savedSalePricePaise: number | null; product: { sku: string; name: string } }[];
                    charges: { accountId: number; description: string | null; amount: string | number; taxAmount?: string | number | null }[];
                }>(`/api/inventory/vouchers/${editId}`);
                if (cancelled) return;
                if (data.type !== "POS" || data.deletedAt || data.status === "CANCELLED") {
                    toast.error("This POS sale can't be edited.");
                    router.push("/office/accountancy/vouchers-registers/sales");
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
                    description: l.description?.split(" · ").slice(1).join(" · ") || "",
                    taxRate: Number(l.taxRate),
                    mrpPaise: l.mrpPaise,
                    barcodePaise: l.savedSalePricePaise,
                })));
            } catch (e: unknown) {
                if (cancelled) return;
                toast.error(extractApiError(e, "Could not load the sale to edit"));
                router.push("/office/accountancy/vouchers-registers/sales");
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
                    description: l.description?.split(" · ").slice(1).join(" · ") || "",
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
        // account credit. No checkout / loyalty / coupon flow on an edit.
        if (isEdit && editMeta.current) {
            if (cart.length === 0) { toast.error("Cart is empty"); return; }
            if (cart.some((l) => l.unitPrice <= 0)) { toast.error("All lines need a unit price"); return; }
            b.setSubmitting(true);
            try {
                await axios.patch(`/api/inventory/vouchers/${editId}`, {
                    lines: cart.map((l) => ({
                        productId: l.productId,
                        description: `${l.sku} — ${l.name}${l.description ? ` · ${l.description}` : ""}`,
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
                router.push("/office/accountancy/vouchers-registers/sales");
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
        if (summaryParts.length === 0) {
            toast.error("Enter Cash or UPI — or it'll all go on credit (which is fine, just say so)");
            return;
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
            // Fully-on-credit isn't a POS sale — surface a clear error.
            if (paymentsList.length === 0 && b.payableTotal > 0.005) {
                toast.error("POS sale needs at least one paid line (cash, UPI, or other). Use 'Save as credit invoice' for fully-on-credit sales.");
                b.setSubmitting(false);
                return;
            }
            // Under-pay would be a credit sale — not allowed at POS (use /sale).
            // Over-pay IS allowed when collecting surplus: the server books the
            // extra as a separate Receipt voucher (clears oldest dues FIFO, any
            // leftover = customer advance) so the bank/UPI statement matches 1:1.
            const collectedFromPayments = paymentsList.reduce((s, p) => s + p.amount, 0);
            if (collectedFromPayments + 0.01 < b.payableTotal) {
                toast.error("POS sale must be paid in full. Use 'Save & Print' on /sale for a credit sale.");
                b.setSubmitting(false);
                return;
            }

            const validCharges = b.charges.filter((c) => c.accountId !== null && Math.abs(parseAmt(c.amount)) >= 0.005);
            const { data } = await axios.post<{ voucherId: number; voucherRef: string; pointsEarned: number; pointsRedeemed: number; milestoneBonus: number; milestoneCoupons: string[]; loyaltyBalance: number; couponDiscount: number; couponCode: string | null; posTemplate: VoucherTemplateDefaults; surplusCollected: number; arrearCleared: number; advanceCredited: number; receiptVoucherId: number | null; receiptVoucherRef: string | null }>("/api/pos/sale", {
                accountId: snapshot.account.id,
                issueDate: today,
                dueDate: toDateOnly(due),   // local day, same reason as `today`
                notes: `POS sale (discount ${b.discountPct}%${b.effRedeemPts > 0 ? `, ${b.effRedeemPts} pts redeemed` : ""}${b.appliedCoupon ? `, coupon ${b.appliedCoupon.code ?? b.appliedCoupon.name}` : ""}) | Payments: ${splitSummary}${tail}`,
                lines: cart.filter((l) => l.kind !== "service").map((l) => ({
                    productId: l.productId,
                    description: `${l.sku} — ${l.name}${l.description ? ` · ${l.description}` : ""}`,
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
                autoApply: !b.appliedCoupon && !!b.autoCoupon,     // let the server pick the best auto offer
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
            const gcCouponMsg = data.milestoneCoupons?.length ? ` 🎟 coupon ${data.milestoneCoupons.join(", ")} issued!` : "";
            let surplusMsg = "";
            if (data.surplusCollected > 0) {
                const parts: string[] = [];
                if (data.arrearCleared > 0) parts.push(`cleared dues ${formatInr(data.arrearCleared)}`);
                if (data.advanceCredited > 0) parts.push(`advance ${formatInr(data.advanceCredited)}`);
                surplusMsg = ` · ${data.receiptVoucherRef ?? "Receipt"} +${formatInr(data.surplusCollected)}${parts.length ? ` (${parts.join(", ")})` : ""}`;
            }
            toast.success(`Invoice ${data.voucherRef} · ${formatInr(b.total)}${couponMsg}${ptsMsg}${bonusMsg}${gcCouponMsg}${surplusMsg}`);
            // Show "Thank You ₹X" on the customer display and hold it so the
            // coordinator doesn't immediately overwrite it as state resets.
            void qrDisplay.thankyou({ amount: b.total });
            b.setDisplayHold("thankyou");
            setTimeout(() => b.setDisplayHold(null), 4500);
            b.resetAfterSubmit();
            convertFromRef.current = null;   // conversion completed
            if (printAfter) {
                const relayAvailable = await fetch("http://localhost:9191/health", { signal: AbortSignal.timeout(1000) })
                    .then((r) => r.ok).catch(() => false);
                if (relayAvailable) {
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
                    fetch("http://localhost:9191/print/pos", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            invoiceNumber: data.voucherRef,
                            date: today,
                            customerName: snapshot?.party.name ?? "Walk-in",
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
                                return {
                                    name: l.name,
                                    qty: l.qty,
                                    unitPrice: l.unitPrice,
                                    amount: l.qty * l.unitPrice,
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
                            // voucher (RV-…), so the sale slip shows NO payment lines
                            // (the sale is settled to the customer account). Exact-pay
                            // sales keep the traditional cash/UPI breakdown.
                            cashPaid: b.overpaid > 0 ? 0 : b.cashNet,
                            upiPaid: b.overpaid > 0 ? 0 : b.upiEntered,
                            extrasPaid: b.overpaid > 0 ? [] : splits
                                .filter((s) => s.amount > 0 && payAccountById.get(s.paymentAccountId ?? -1)?.channel !== "UPI")
                                .map((s) => ({ method: payAccountById.get(s.paymentAccountId ?? -1)?.label ?? "Other", amount: s.amount, reference: s.reference })),
                            // "Today's discount" ladder (additive).
                            grossAtTag: printLadder.barcodeTotal,
                            discounts: printLadder.discounts.map((d) => ({ label: d.label, amount: d.amount })),
                            charges: printLadder.charges.map((c) => ({ label: c.label, amount: c.amount })),
                            savings: printLadder.savingsTotal > 0 ? { amount: printLadder.savingsTotal, pct: printLadder.savingsPct } : null,
                            hsnSummary: printLadder.hsn,
                            // Total GST embedded in the bill (goods + shipping/tax-bearing
                            // charges) — additive field, older relays ignore it.
                            taxTotal: printLadder.taxTotal,
                        }),
                    }).catch(() => toast.error("Thermal print failed"));
                    // Overpayment booked a separate Receipt voucher (RV-…). On a
                    // relay setup it prints on the SAME thermal printer — the tender
                    // breakdown lives here, not on the sale slip above.
                    if (data.receiptVoucherId) {
                        const rcvTenders: { label: string; amount: number }[] = [];
                        if (b.cashNet > 0) rcvTenders.push({ label: "Cash", amount: b.cashNet });
                        for (const s of splits) {
                            if (s.amount <= 0) continue;
                            rcvTenders.push({ label: payAccountById.get(s.paymentAccountId ?? -1)?.label ?? "Payment", amount: s.amount });
                        }
                        fetch("http://localhost:9191/print/payment", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                reference: data.receiptVoucherRef,
                                date: today,
                                party: snapshot?.party.name ?? null,
                                tenders: rcvTenders,
                                total: b.collected,
                                arrear: data.arrearCleared,
                                advance: data.advanceCredited,
                                note: `Against ${data.voucherRef}`,
                            }),
                        }).catch(() => toast.error("Receipt voucher print failed"));
                    }
                } else {
                    window.open(`/receipt/invoice/${data.voucherId}?kind=POS&autoprint=1`, "_blank", "noopener");
                    // No relay → print the Receipt voucher in the browser too
                    // (/receipt/payment/[id] auto-prints on mount).
                    if (data.receiptVoucherId) {
                        window.open(`/receipt/payment/${data.receiptVoucherId}`, "_blank", "noopener");
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
                    onClick={isEdit ? () => void generateInvoice(false) : b.openCheckout} 
                    disabled={b.cart.length === 0 || !b.snapshot?.account || b.submitting || b.saleNoteMissing} 
                    className="h-12 w-full text-base" 
                    size="lg"
                    title={
                        b.cart.length === 0 ? "Scan an item first" :
                        !b.snapshot?.account ? "Select a customer first" :
                        b.saleNoteMissing ? "Add required note to the flagged line" :
                        b.submitting ? "Saving…" :
                        "Checkout"
                    }
                >
                    <ReceiptIndianRupee size={18} /> {isEdit ? `Update Sale · ${formatInr(b.total)}` : `Checkout · ${formatInr(b.total)}`}
                    <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">Ctrl ↵</span>
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

            {/* ── Checkout dialog — fixed Cash / UPI / Credit rows ──────────────── */}
            <CheckoutDialog
                open={b.checkoutOpen}
                onOpenChange={b.setCheckoutOpen}
                total={b.total}
                collected={b.collected}
                onCredit={b.onCredit}
                payableTotal={b.payableTotal}
                overpaid={b.overpaid}
                balanceDue={b.balanceDue}
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
        </PosScreenShell>
    );
}
