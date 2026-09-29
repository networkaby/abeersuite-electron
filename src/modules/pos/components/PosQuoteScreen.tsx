"use client";

// ── PosQuoteScreen (Order / Estimate) ─────────────────────────────────────────
// Order and Estimate are ONE screen with a few seams. Order takes an optional
// advance through the checkout dialog and LOCKS the full bill discount (its total
// must equal the Sale it becomes); Estimate is a non-binding quote with the tier
// discount only — it takes no money, so it (and any edit) confirms through the
// checkout dialog's "confirm" mode: Enter saves, Ctrl+Enter saves + prints.
// The protected Sale screen (/vouchers/pos/new, PosScreen.tsx) is deliberately
// NOT folded in here. All shared state + bill math lives in usePosBilling; the
// shared render tree lives in PosScreenShell.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import axios from "axios";
import { toast } from "sonner";
import { ReceiptIndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckoutDialog } from "@/modules/pos/components/CheckoutDialog";
import { ClearBillDialog } from "@/modules/pos/components/ClearBillDialog";
import { PaymentLinkDialog } from "@/modules/pos/components/PaymentLinkDialog";
import { PosScreenShell } from "@/modules/pos/components/PosScreenShell";
import { usePosBilling } from "@/modules/pos/hooks/usePosBilling";
import { qrDisplay } from "@/modules/pos/lib/qrDisplay";
import { extractApiError } from "@/shared/lib/api";
import { formatInr, todayIso } from "@/shared/lib/format";
import { printVoucherThermal } from "@/shared/lib/print/silentThermalPrint";
import type { PartySearchAndCreateHandle } from "@/shared/components/PartySearchAndCreate";

type QuoteMode = "order" | "estimate";
const QUOTE_CFG = {
    order: {
        header: "border-indigo-300 bg-indigo-100/70 dark:border-indigo-900 dark:bg-indigo-950/30",
        endpoint: "/api/pos/order",
        saveErr: "Failed to save order",
    },
    estimate: {
        header: "border-amber-300 bg-amber-100/70 dark:border-amber-900 dark:bg-amber-950/30",
        endpoint: "/api/pos/estimate",
        saveErr: "Failed to save estimate",
    },
} as const;

export default function PosQuoteScreen({ mode, editId }: { mode: QuoteMode; editId?: number }) {
    const cfg = QUOTE_CFG[mode];
    const printKind = mode === "order" ? "POS_ORDER" : "POS_ESTIMATE";
    // "Save Estimate" / "Update Order" — the button, the dialog title and its CTAs.
    const noun = mode === "order" ? "Order" : "Estimate";
    const router = useRouter();
    // Leaving an edit returns to the office list for this kind — or the POS register,
    // for a cashier the page lock (pageAccess.ts) keeps out of it.
    const canOpen = useCanOpenPage();
    const officeList = mode === "order" ? "/office/ecommerce/orders" : "/office/accountancy/vouchers-registers/estimates";
    const listHref = canOpen(officeList) ? officeList : "/vouchers/pos";
    // Edit mode: reopen an existing order / estimate in this same screen, hydrate
    // its customer + lines, and PATCH on save instead of creating a new voucher.
    // Both go through the order endpoint — it accepts POS_ESTIMATE too (GL-silent).
    const isEdit = editId != null;
    const verb = isEdit ? "Update" : "Save";

    // Focus/handle refs — owned here, shared with the hook and the shell.
    const partySearchRef = useRef<PartySearchAndCreateHandle>(null);
    const productSearchRef = useRef<HTMLInputElement>(null);
    const cashTenderedRef = useRef<HTMLInputElement>(null);

    // Ctrl/Cmd+Enter → the checkout dialog, like the Sale: a new Order collects
    // its (optional) advance there; an Estimate or an edit just confirms.
    const b = usePosBilling({
        onHotkeyConfirm: () => b.openCheckout(),
        partySearchRef,
        productSearchRef,
        cashTenderedRef,
    });

    // ── Edit mode: hydrate an existing order on mount ───────────────────────────
    // Reopen the order in this very screen — load its customer (so the tier discount
    // re-derives) and rebuild the cart from its lines. Only New / Under-Review orders
    // are editable; the GET reports that and we bounce out otherwise.
    useEffect(() => {
        if (!isEdit) return;
        b.resetDraft();
        let cancelled = false;
        (async () => {
            try {
                const { data } = await axios.get<{
                    accountId: number | null;
                    editable: boolean;
                    lines: { productId: number; sku: string; name: string; description: string | null; quantity: number; rate: number; taxRate: number; mrpPaise: number | null; savedSalePricePaise: number | null }[];
                    services?: { serviceId: number; name: string; quantity: number; rate: number; taxRate: number; description: string | null }[];
                }>(`/api/orders/inv/${editId}`);
                if (cancelled) return;
                if (!data.editable) {
                    toast.error("This order can't be edited at its current stage.");
                    router.push(listHref);
                    return;
                }
                if (data.accountId != null) await b.fetchSnapshot(data.accountId);
                if (cancelled) return;
                b.setCart([
                    ...data.lines.map((l) => ({
                        productId: l.productId,
                        sku: l.sku,
                        name: l.name,
                        qty: l.quantity,
                        unitPrice: l.rate,
                        // The server embeds "sku — name · note"; keep only the cashier's note.
                        description: l.description?.split(" · ").slice(1).join(" · ") || "",
                        taxRate: l.taxRate,
                        mrpPaise: l.mrpPaise,
                        barcodePaise: l.savedSalePricePaise,
                    })),
                    // Service lines come back keyed the way the cart holds them:
                    // −serviceId, so they can never collide with a product id.
                    ...(data.services ?? []).map((s) => ({
                        productId: -s.serviceId,
                        sku: "SVC",
                        name: s.name,
                        kind: "service" as const,
                        qty: s.quantity,
                        unitPrice: s.rate,
                        description: s.description ?? "",
                        taxRate: s.taxRate,
                    })),
                ]);
            } catch (e: unknown) {
                if (cancelled) return;
                toast.error(extractApiError(e, `Could not load the ${mode} to edit`));
                router.push(listHref);
            }
        })();
        return () => { cancelled = true; b.resetDraft(); };
        // One-shot hydration keyed on the voucher id; the helpers it calls are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEdit, editId]);

    const generateInvoice = async (printAfter = false) => {
        const { snapshot, cart, splits } = b;
        if (!snapshot?.account) { toast.error("Select a customer first"); return; }
        if (cart.length === 0) { toast.error("Cart is empty"); return; }
        if (cart.some((l) => l.unitPrice <= 0)) { toast.error("All lines need a unit price"); return; }
        // Products and services travel in separate arrays: a product line moves
        // stock, a service line posts to its ledger. The cart holds both.
        const goodsCart = cart.filter((l) => l.kind !== "service");
        const serviceCart = cart.filter((l) => l.kind === "service");
        // Edit mode → PATCH the existing order's lines + discount (server recomputes
        // exactly like creation). No advance on an edit; print only when asked.
        if (isEdit) {
            b.setSubmitting(true);
            try {
                await axios.patch(`/api/orders/inv/${editId}`, {
                    lines: goodsCart.map((l) => ({
                        productId: l.productId,
                        description: l.description || null,
                        quantity: l.qty,
                        rate: l.unitPrice,
                        taxRate: l.taxRate,
                        mrpPaise: l.mrpPaise ?? null,
                        savedSalePricePaise: l.barcodePaise ?? null,
                    })),
                    services: serviceCart.map((l) => ({
                        serviceId: -l.productId,
                        quantity: l.qty,
                        unitPrice: l.unitPrice,
                        description: l.description || null,
                    })),
                    // Order locks the full bill discount (tier + loyalty + coupon) + shipping
                    // + round-off; an estimate is a tag-price quote → tier discount only.
                    discountAmt: mode === "order" ? b.totalDiscount : b.discountAmount,
                    discountPct: b.discountAmount > 0 ? b.discountPct : 0,
                    shippingAmt: mode === "order" ? b.shippingAmt : 0,
                    roundOff: mode === "order" ? b.roundOff : 0,
                });
                toast.success(mode === "order" ? "Order updated" : "Estimate updated");
                b.setCheckoutOpen(false);   // no second Enter while the page navigates away
                if (printAfter) await printVoucherThermal("inv", editId, printKind);
                router.push(listHref);
            } catch (e: unknown) {
                toast.error(extractApiError(e, `Failed to update ${mode}`));
            } finally {
                b.setSubmitting(false);
            }
            return;
        }

        // Order = OPTIONAL advance. Build payment tenders from the checkout dialog
        // (may be empty → no receipt voucher), mirroring the POS sale tender shape.
        // Estimate never collects payment, so its tender list stays empty.
        type PayLine = { paymentAccountId: number | null; amount: number; reference?: string };
        const paymentsList: PayLine[] = [];
        if (mode === "order") {
            if (b.cashNet > 0) paymentsList.push({ paymentAccountId: null, amount: b.cashNet });
            for (const s of splits) {
                if (s.amount <= 0) continue;
                paymentsList.push({ paymentAccountId: s.paymentAccountId, amount: s.amount, reference: s.reference || undefined });
            }
        }
        const advance = paymentsList.reduce((s, p) => s + p.amount, 0);
        if (advance > b.total + 0.01) { toast.error("Advance can't exceed the order total"); return; }
        b.setSubmitting(true);
        try {
            const today = todayIso();
            const lines = goodsCart.map((l) => ({
                productId: l.productId,
                description: `${l.sku} — ${l.name}${l.description ? ` · ${l.description}` : ""}`,
                quantity: l.qty,
                unitPrice: l.unitPrice,
                taxRate: l.taxRate,
                mrpPaise: l.mrpPaise ?? null,
                savedSalePricePaise: l.barcodePaise ?? null,
            }));
            // A service line's cart id is −serviceId (see addServiceToCart), so
            // the catalogue id is read straight back off it.
            const services = serviceCart.map((l) => ({
                serviceId: -l.productId,
                quantity: l.qty,
                unitPrice: l.unitPrice,
                description: l.description || null,
            }));
            const party = {
                accountId: snapshot.account.id,
                partyType: snapshot.party.kind === "company" ? "company" : "customer",
                partyId: snapshot.party.id,
                partyName: snapshot.party.name,
                partyPhone: snapshot.party.phone ?? null,
                date: today,
            } as const;
            // Order is LOCKED = its total must equal the POS sale it will become, so it
            // carries the FULL bill discount (tier + loyalty + coupon) + shipping +
            // round-off, riding the same calcVoucherTotals the sale uses (loyalty/coupon
            // are RECORDED here, redeemed at fulfilment — Phase 2 holds). Any advance is
            // posted as a SECOND Receipt voucher. Estimate is a non-binding quote: tier
            // discount only, no shipping/round-off/payment.
            const body = mode === "order"
                ? {
                    ...party,
                    discountAmt: b.totalDiscount,
                    discountPct: b.discountAmount > 0 ? b.discountPct : 0,
                    shippingAmt: b.shippingAmt,
                    roundOff: b.roundOff,
                    services,
                    notes: `POS Order — tier ${b.discountPct}%`
                        + (b.effRedeemPts > 0 ? `, loyalty ${b.effRedeemPts}pts ₹${b.effRedemptionRupees.toFixed(2)}` : "")
                        + (b.appliedCoupon ? `, coupon ${b.appliedCoupon.code ?? b.appliedCoupon.name} ₹${b.couponRupees.toFixed(2)}` : "")
                        + (advance > 0 ? ` | Advance ${formatInr(advance)}` : ""),
                    lines,
                    payments: paymentsList,
                }
                : {
                    ...party,
                    discountAmt: b.discountAmount,
                    discountPct: b.discountAmount > 0 ? b.discountPct : 0,
                    notes: `POS Estimate (discount ${b.discountPct}%)`,
                    lines,
                    services,
                };
            const { data } = await axios.post<{ voucherId: number; reference: string; dealId: number | null; receiptVoucherId?: number | null; receiptVoucherRef?: string | null }>(cfg.endpoint, body);
            if (mode === "order") {
                const advMsg = data.receiptVoucherRef ? ` · advance ${data.receiptVoucherRef} ${formatInr(advance)}` : "";
                toast.success(`Order ${data.reference} · ${formatInr(b.total)}${data.dealId ? " · lead captured" : ""}${advMsg}`);
            } else {
                toast.success(`Estimate ${data.reference} · ${formatInr(b.total)}${data.dealId ? " · lead captured" : ""}`);
            }
            void qrDisplay.idle();
            b.resetAfterSubmit();
            if (printAfter) {
                // Silent thermal like a POS sale; no printer → the 80mm format page.
                await printVoucherThermal("inv", data.voucherId, printKind);
                // Advance receipt prints as a second slip (GL voucher source).
                if (data.receiptVoucherId) await printVoucherThermal("gl", data.receiptVoucherId, "RECEIPT");
            }
        } catch (e: unknown) {
            toast.error(extractApiError(e, cfg.saveErr));
        } finally {
            b.setSubmitting(false);
        }
    };

    return (
        <PosScreenShell
            b={b}
            headerClass={cfg.header}
            active={mode}
            partySearchRef={partySearchRef}
            productSearchRef={productSearchRef}
            checkoutSlot={
                <Button
                    onClick={() => b.openCheckout()}
                    disabled={b.cart.length === 0 || !b.snapshot?.account || b.submitting}
                    className="h-12 w-full text-base"
                    size="lg"
                    title={
                        b.cart.length === 0 ? "Scan an item first" :
                        !b.snapshot?.account ? "Select a customer first" :
                        b.submitting ? "Saving…" :
                        `${verb} ${noun}`
                    }
                >
                    <ReceiptIndianRupee size={18} /> {`${verb} ${noun} · ${formatInr(b.total)}`}
                    <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">Ctrl ↵</span>
                </Button>
            }
        >
            {/* ── Checkout dialog — the same dialog as POS Sale. A new Order uses
                "order" mode (advance optional, no credit-limit block); an Estimate
                or an edit takes no money, so "confirm" mode — title + the two
                CTAs only. ─────────────────────────────────────────────────── */}
            <CheckoutDialog
                mode={isEdit || mode === "estimate" ? "confirm" : "order"}
                title={`${verb} ${noun} · ${formatInr(b.total)}`}
                confirmLabel={`${verb} ${noun}`}
                confirmPrintLabel={`${verb} & Print ${noun}`}
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
                onShare={(a) => { b.setShareVpa(a.vpa); b.setShareOpen(true); }}
            />

            {/* ── Mid-bill clear confirmation (Shift+Esc) ────────────────────── */}
            <ClearBillDialog
                open={b.clearCartDialogOpen}
                onOpenChange={b.setClearCartDialogOpen}
                onConfirm={b.clearBill}
            />

            {/* Share a UPI QR with the customer to collect the advance remotely. */}
            <PaymentLinkDialog
                open={b.shareOpen}
                onOpenChange={b.setShareOpen}
                defaultAmount={b.onCredit > 0.01 ? b.onCredit : b.total}
                partyName={b.snapshot?.party.name}
                partyPhone={b.snapshot?.party.phone ?? null}
                upiVpa={b.shareVpa}
                lockedProviderId="upi"
            />
        </PosScreenShell>
    );
}
