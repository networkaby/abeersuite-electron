// ── Trading-voucher per-kind config + pure line math ─────────────────────────
// Extracted from TradingVoucherPage.tsx (which had grown past 2,600 lines).
// Everything here is pure (no React): the per-line form state shape, the line
// calculator, and the per-kind UI/behaviour table shared by all eleven
// trading-voucher kinds.

import type { SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import { parseDecimalInput, round2 } from "@/shared/lib/format";

// ── Per-line state ─────────────────────────────────────────────────────────

/** A service picked from the catalogue (Settings → Services), as a voucher line
 *  carries it. `defaultPricePaise` is TAX-INCLUSIVE — what the customer pays —
 *  so the form converts it to the rate the PRICE column is currently showing. */
export type SelectedService = {
    id: number;
    name: string;
    taxRate: number;
    defaultPricePaise: number | null;
};

export type LineState = {
    id: number;
    product: SelectedProduct | null;
    /// Set INSTEAD of `product` on a service row. A service line behaves like
    /// any other line — qty × rate, its own GST, its own amount — but posts to
    /// the service's ledger as a charge rather than moving stock, which is why
    /// the two never appear on one row.
    service: SelectedService | null;
    quantity: string;
    freeQty: string;
    rate: string;
    /// MRP in ₹ — editable on PURCHASE lines so the product master can be kept
    /// current; display-only (from product.mrp) on SALE / other kinds.
    mrpRupees: string;
    discountPct: string;
    discountAmt: string;
    taxRate: string;
    taxAmount: string;
    amountInput: string;
    description: string;
    showDescription: boolean;
};

let lineSeq = 0;
/** Next unique client-side line id — shared with newLine's counter. */
export const nextLineId = () => ++lineSeq;
export const newLine = (): LineState => ({
    id: ++lineSeq,
    product: null,
    service: null,
    quantity: "1",
    // Leave optional numeric fields blank instead of pre-filling "0" —
    // empty inputs read cleaner in dense tables. calcLine handles the
    // empty case via parseFloat("") || 0.
    freeQty: "",
    rate: "",
    mrpRupees: "",
    discountPct: "",
    discountAmt: "",
    taxRate: "",
    taxAmount: "",
    amountInput: "",
    description: "",
    showDescription: false,
});

export type CalcOpts = { applyDiscount?: boolean; applyTax?: boolean; rateInclTax?: boolean };
// Rounds `amount` to 2dp so it matches what's shown per-line and what the
// server independently re-derives (calcLineTotals in modules/inventory/lib/
// stock.ts). A tax-inclusive rate that doesn't divide evenly (e.g. ₹2100
// incl. 18% → ₹1779.661016... excl.) otherwise carries float precision past
// 2dp into lineSubtotal/grandTotal, drifting a paisa or two from the sum of
// the rounded per-line AMOUNT cells the operator actually sees — which then
// trips the server's tenders-sum-must-match-total check.
export function calcLine(l: LineState, opts: CalcOpts = {}) {
    const { applyDiscount = true, applyTax = true, rateInclTax = false } = opts;
    const qty = parseFloat(l.quantity) || 0;
    const rawRate = parseFloat(l.rate) || 0;
    // When rate is inclusive of tax, back-calculate the exclusive rate for
    // gross computation so that (gross − discount) × taxRate = taxAmount.
    const tRate = parseFloat(l.taxRate) || 0;
    const rate = rateInclTax && tRate > 0 ? rawRate / (1 + tRate / 100) : rawRate;
    const gross = qty * rate;
    const discAmt = applyDiscount ? (parseFloat(l.discountAmt) || 0) : 0;
    const taxable = gross - discAmt;
    const taxAmt = applyTax ? (parseFloat(l.taxAmount) || 0) : 0;
    return { gross, discAmt, taxAmt, amount: round2(taxable + taxAmt) };
}


/**
 * Re-derive a line's discount and tax after its quantity or rate changed.
 * `discountPct` is the source of truth here — the amount is recomputed from it,
 * then tax from what is left. Shared by the qty/rate editors and by the
 * merge-a-repeated-item path, so a scanned duplicate is priced exactly the way
 * a hand-typed quantity is.
 */
export function reprice(l: LineState, rateInclTax: boolean): LineState {
    const rawRate = parseFloat(l.rate) || 0;
    const tRate = parseFloat(l.taxRate) || 0;
    // Use the exclusive rate for the discount regardless of display mode.
    const rate = rateInclTax && tRate > 0 ? rawRate / (1 + tRate / 100) : rawRate;
    const gross = (parseFloat(l.quantity) || 0) * rate;
    const discAmt = gross * ((parseFloat(l.discountPct) || 0) / 100);
    const taxAmt = (gross - discAmt) * (tRate / 100);
    return {
        ...l,
        discountAmt: discAmt > 0 ? discAmt.toFixed(2) : "",
        taxAmount: taxAmt > 0 ? taxAmt.toFixed(2) : "",
    };
}

/** Build a voucher line from a catalogue service.
 *
 * The catalogue price is TAX-INCLUSIVE — ₹300 on a service at 18% means the
 * customer pays ₹300, not ₹354 — but the voucher's PRICE column may be showing
 * either mode. So the price is converted to whichever mode is on:
 *
 *   inclusive column → ₹300.00 goes straight in;
 *   exclusive column → ₹254.237288 goes in, and the GST column brings it back
 *                      to ₹300.00 on the AMOUNT.
 *
 * The exclusive value keeps six decimals on purpose. Rounded to two it would be
 * 254.24, which grosses back up to ₹300.0032 — a line the operator never typed
 * and, on a long bill, a paisa of drift against the payment rows. Six decimals
 * divide back exactly. (`setLineAmount` keeps the same precision for the same
 * reason.) The catalogue price may be missing entirely, and then the rate is
 * left blank for the operator to type, exactly like a product with no price.
 */
export function serviceLine(svc: SelectedService, rateInclTax: boolean): LineState {
    const inclusive = svc.defaultPricePaise != null ? svc.defaultPricePaise / 100 : null;
    const rate = inclusive == null
        ? ""
        : rateInclTax || svc.taxRate <= 0
            ? inclusive.toFixed(2)
            : String(Number((inclusive / (1 + svc.taxRate / 100)).toFixed(6)));
    return reprice({
        ...newLine(),
        service: svc,
        rate,
        taxRate: svc.taxRate > 0 ? String(svc.taxRate) : "",
    }, rateInclTax);
}

// Numeric input sanitizers — type="text" lets us avoid the awful native
// number-spinner UI; we filter keystrokes to digits + a single decimal
// point. `numSigned` additionally permits a leading minus (used for
// round-off which can legitimately be negative).
export function numSigned(s: string): string {
    const sign = s.trimStart().startsWith("-") ? "-" : "";
    return sign + parseDecimalInput(s);
}

// ── Per-kind config — UI labels + behaviour swaps ──────────────────────────
// All four trading-voucher kinds share the same form shape (party + item
// table + totals + cash/bank picker). Only labels, party group, rate
// auto-fill source, ref field, and a few visibility flags differ.

export type TradingKind =
    | "SALE" | "PURCHASE" | "SALE_RETURN" | "PURCHASE_RETURN"
    | "SALES_ORDER" | "PURCHASE_ORDER"
    | "GRN" | "CHALLAN"
    | "REJECTION_IN" | "REJECTION_OUT"
    | "ESTIMATE";  // PREVIEW MIGRATION — quotation/estimate, no GL/stock impact

export type KindConfig = {
    title:            string;
    party:            "Sundry Debtors" | "Sundry Creditors";
    partyPlaceholder: string;
    ratePick:         (p: SelectedProduct) => number | null | undefined;
    /// null → no Bill/Original-Invoice field on the form
    refLabel:         string | null;
    refDateLabel:     string;
    /// When true, the ref number + ref date fields render without the
    /// required-asterisk and the submit validation skips them. Used by
    /// kinds where the upstream document (Customer PO, etc.) is nice-to-
    /// have but not always available — currently Delivery Challan.
    refOptional?:     boolean;
    listPath:         string;
    nextRefType:      TradingKind;
    showProfit:       boolean;
    cashLedgerLabel:  string;
    /// Plain narration to fall back on when user leaves it blank
    narrationFallback: (partyName: string | undefined) => string;
    successPostedMsg: string;
    successDraftMsg:  string;
    newButtonLabel:   string;
    closeRouteLabel:  string;
    /// Label shown above the auto-generated reference preview (varies per
    /// kind: "Invoice Number" / "Voucher No" / "CN Number"). Reference
    /// itself is always system-generated via VoucherSeries.
    voucherRefLabel:  string;
    voucherDateLabel: string;
    /// Purchase hides the Invoice Number from UI (PV-… is still saved in
    /// DB) — the supplier's bill number is what users care about.
    showVoucherRef:   boolean;
    /// Purchase hides the Invoice Date — Bill Date replaces it, and at
    /// submit time the voucher's `date` is sourced from refDate.
    showVoucherDate:  boolean;
    /// Returns (SR / PR) don't carry credit-term semantics so the
    /// Payment Terms + Due Date pair is hidden entirely.
    showPaymentTerms: boolean;
    /// CASH / CREDIT pill, Received / Balance row, Payment Account picker.
    /// Hidden on non-GL kinds (orders, GRN, challan, rejections) where money
    /// settlement is irrelevant — the linked Sale / Purchase invoice posts GL.
    showPaymentBlock: boolean;
    /// Optional FK link to a source voucher (e.g. GRN → PURCHASE_ORDER). When
    /// set, the form renders a parent picker; on pick, lines auto-copy and
    /// refVoucherId / refNumber / refDate save with the voucher.
    /// `null` disables the picker.
    linkParentType:   TradingKind | null;
    /// Label for the parent-voucher picker ("Link to Purchase Order").
    linkParentLabel:  string | null;
    /// Render the Challan-only "Show prices on print" toggle.
    showShowPricesToggle: boolean;
    /// Label for the amount-paid/received input row. Defaults to "Received".
    /// Purchase invoices should show "Paid" instead.
    receivedLabel?: string;
};

export const PER_KIND: Record<TradingKind, KindConfig> = {
    SALE: {
        title: "Sale Invoice",
        party: "Sundry Debtors",
        partyPlaceholder: "Search customer by name or phone…",
        ratePick: (p) => p.salePrice,
        refLabel: null, refDateLabel: "",
        listPath: "/office/accountancy/vouchers-registers/sales",
        nextRefType: "SALE",
        showProfit: true,
        cashLedgerLabel: "Received in",
        narrationFallback: (n) => n ? `Sale to ${n}` : "Cash sale",
        successPostedMsg: "Sale posted — stock & GL updated",
        successDraftMsg:  "Sale saved as draft",
        newButtonLabel: "New Sale",
        closeRouteLabel: "Open another Sale Invoice in a new tab",
        voucherRefLabel: "Invoice Number",
        voucherDateLabel: "Invoice Date",
        showVoucherRef: true,
        showVoucherDate: true,
        showPaymentTerms: true,
        showPaymentBlock: true,
        // When a Sale is raised against a Challan, picking the Challan here sets
        // refVoucherId = challanId → the Challan is marked as settled in the
        // Pending Vouchers report. Optional — direct (non-Challan) sales leave blank.
        linkParentType: "CHALLAN", linkParentLabel: "Convert from Challan (optional)",
        showShowPricesToggle: false,
    },
    PURCHASE: {
        title: "Purchase Invoice",
        party: "Sundry Creditors",
        partyPlaceholder: "Search supplier by name or phone…",
        ratePick: (p) => p.costPrice,
        refLabel: "Bill Number", refDateLabel: "Bill Date",
        listPath: "/office/accountancy/vouchers-registers/purchases",
        nextRefType: "PURCHASE",
        showProfit: false,
        cashLedgerLabel: "Paid from",
        narrationFallback: (n) => n ? `Purchase from ${n}` : "Cash purchase",
        successPostedMsg: "Purchase posted — stock & GL updated",
        successDraftMsg:  "Purchase saved as draft",
        newButtonLabel: "New Purchase",
        closeRouteLabel: "Open another Purchase Invoice in a new tab",
        // Invoice number (PV-…) still generated server-side + saved to DB,
        // just hidden from UI — users care about the supplier's Bill Number.
        voucherRefLabel: "Invoice Number",
        voucherDateLabel: "Invoice Date",
        showVoucherRef: false,
        showVoucherDate: false,   // Bill Date drives the voucher date on submit
        showPaymentTerms: true,   // credit purchases still need terms / due date
        showPaymentBlock: true,
        receivedLabel: "Paid",
        // When a Purchase is raised against a GRN, picking the GRN here sets
        // refVoucherId = grnId → the GRN is marked as settled in the
        // Pending Vouchers report. Optional — direct (non-GRN) purchases leave blank.
        linkParentType: "GRN", linkParentLabel: "Convert from GRN (optional)",
        showShowPricesToggle: false,
    },
    SALE_RETURN: {
        title: "Sale Return",
        party: "Sundry Debtors",
        partyPlaceholder: "Search customer by name or phone…",
        ratePick: (p) => p.salePrice,
        refLabel: "Original Invoice", refDateLabel: "Original Invoice Date",
        refOptional: true,
        listPath: "/office/accountancy/vouchers-registers/sale-returns",
        nextRefType: "SALE_RETURN",
        showProfit: false,
        cashLedgerLabel: "Refunded from",
        narrationFallback: (n) => n ? `Sale return from ${n}` : "Sale return",
        successPostedMsg: "Sale Return posted — stock & GL updated",
        successDraftMsg:  "Sale Return saved as draft",
        newButtonLabel: "New Return",
        closeRouteLabel: "Open another Sale Return in a new tab",
        voucherRefLabel: "CN Number",
        voucherDateLabel: "CN Date",
        showVoucherRef: true,
        showVoucherDate: true,
        showPaymentTerms: false,  // returns don't carry credit-term semantics
        showPaymentBlock: true,
        linkParentType: null, linkParentLabel: null,
        showShowPricesToggle: false,
    },
    PURCHASE_RETURN: {
        title: "Purchase Return",
        party: "Sundry Creditors",
        partyPlaceholder: "Search supplier by name or phone…",
        ratePick: (p) => p.costPrice,
        refLabel: "Original Bill", refDateLabel: "Original Bill Date",
        refOptional: true,
        listPath: "/office/accountancy/vouchers-registers/purchase-returns",
        nextRefType: "PURCHASE_RETURN",
        showProfit: false,
        cashLedgerLabel: "Recovered into",
        narrationFallback: (n) => n ? `Purchase return to ${n}` : "Purchase return",
        successPostedMsg: "Purchase Return posted — stock & GL updated",
        successDraftMsg:  "Purchase Return saved as draft",
        newButtonLabel: "New Return",
        closeRouteLabel: "Open another Purchase Return in a new tab",
        voucherRefLabel: "Voucher No",
        voucherDateLabel: "Voucher Date",
        showVoucherRef: true,
        showVoucherDate: true,
        showPaymentTerms: false,
        showPaymentBlock: true,
        linkParentType: null, linkParentLabel: null,
        showShowPricesToggle: false,
    },
    // ── Stock-only / commitment vouchers (no GL posting). They share the
    // rich Sale/Purchase form but hide the payment block since money
    // settlement happens on the linked invoice, not here. ─────────────────
    SALES_ORDER: {
        title: "Sales Order",
        party: "Sundry Debtors",
        partyPlaceholder: "Search customer by name or phone…",
        ratePick: (p) => p.salePrice,
        refLabel: "Customer PO Ref", refDateLabel: "Customer PO Date",
        listPath: "/office/accountancy/vouchers-registers/sales-orders",
        nextRefType: "SALES_ORDER",
        showProfit: true,
        cashLedgerLabel: "—",
        narrationFallback: (n) => n ? `Sales Order for ${n}` : "Sales Order",
        successPostedMsg: "Sales Order confirmed — no stock or GL impact until fulfilled",
        successDraftMsg:  "Sales Order saved as draft",
        newButtonLabel: "New Sales Order",
        closeRouteLabel: "Open another Sales Order in a new tab",
        voucherRefLabel: "SO Number",
        voucherDateLabel: "Order Date",
        showVoucherRef: true,
        showVoucherDate: true,
        showPaymentTerms: false,
        showPaymentBlock: false,
        linkParentType: null, linkParentLabel: null,
        showShowPricesToggle: false,
    },
    PURCHASE_ORDER: {
        title: "Purchase Order",
        party: "Sundry Creditors",
        partyPlaceholder: "Search supplier by name or phone…",
        ratePick: (p) => p.costPrice,
        refLabel: "Supplier Quote Ref", refDateLabel: "Quote Date",
        listPath: "/office/accountancy/vouchers-registers/purchase-orders",
        nextRefType: "PURCHASE_ORDER",
        showProfit: false,
        cashLedgerLabel: "—",
        narrationFallback: (n) => n ? `Purchase Order to ${n}` : "Purchase Order",
        successPostedMsg: "Purchase Order confirmed — no stock or GL impact until receipt",
        successDraftMsg:  "Purchase Order saved as draft",
        newButtonLabel: "New Purchase Order",
        closeRouteLabel: "Open another Purchase Order in a new tab",
        voucherRefLabel: "PO Number",
        voucherDateLabel: "Order Date",
        showVoucherRef: true,
        showVoucherDate: true,
        showPaymentTerms: false,
        showPaymentBlock: false,
        linkParentType: null, linkParentLabel: null,
        showShowPricesToggle: false,
    },
    GRN: {
        title: "Goods Received Note",
        party: "Sundry Creditors",
        partyPlaceholder: "Search supplier by name or phone…",
        ratePick: (p) => p.costPrice,
        refLabel: "Supplier Challan #", refDateLabel: "Supplier Challan Date",
        listPath: "/office/accountancy/vouchers-registers/grn",
        nextRefType: "GRN",
        showProfit: false,
        cashLedgerLabel: "—",
        narrationFallback: (n) => n ? `Goods received from ${n}` : "Goods Received Note",
        successPostedMsg: "GRN posted — stock incremented",
        successDraftMsg:  "GRN saved as draft",
        newButtonLabel: "New GRN",
        closeRouteLabel: "Open another GRN in a new tab",
        voucherRefLabel: "GRN Number",
        voucherDateLabel: "Receipt Date",
        showVoucherRef: true,
        showVoucherDate: true,
        showPaymentTerms: false,
        showPaymentBlock: false,
        linkParentType: "PURCHASE_ORDER",
        linkParentLabel: "Link to Purchase Order",
        showShowPricesToggle: false,
    },
    CHALLAN: {
        title: "Delivery Challan",
        party: "Sundry Debtors",
        partyPlaceholder: "Search customer by name or phone…",
        ratePick: (p) => p.salePrice,
        refLabel: "Customer PO Ref", refDateLabel: "Customer PO Date",
        refOptional: true,
        listPath: "/office/accountancy/vouchers-registers/challans",
        nextRefType: "CHALLAN",
        showProfit: false,
        cashLedgerLabel: "—",
        narrationFallback: (n) => n ? `Delivered to ${n}` : "Delivery Challan",
        successPostedMsg: "Challan posted — stock decremented",
        successDraftMsg:  "Challan saved as draft",
        newButtonLabel: "New Challan",
        closeRouteLabel: "Open another Challan in a new tab",
        voucherRefLabel: "Challan No",
        voucherDateLabel: "Delivery Date",
        showVoucherRef: true,
        showVoucherDate: true,
        showPaymentTerms: false,
        showPaymentBlock: false,
        linkParentType: "SALES_ORDER",
        linkParentLabel: "Link to Sales Order",
        showShowPricesToggle: true,
    },
    REJECTION_IN: {
        title: "Rejection In",
        party: "Sundry Debtors",
        partyPlaceholder: "Search customer by name or phone…",
        ratePick: (p) => p.salePrice,
        refLabel: "Original Ref", refDateLabel: "Original Ref Date",
        listPath: "/office/accountancy/vouchers-registers/rejections-in",
        nextRefType: "REJECTION_IN",
        showProfit: false,
        cashLedgerLabel: "—",
        narrationFallback: (n) => n ? `Goods rejected back from ${n}` : "Rejection In",
        successPostedMsg: "Rejection In posted — stock incremented",
        successDraftMsg:  "Rejection In saved as draft",
        newButtonLabel: "New Rejection In",
        closeRouteLabel: "Open another Rejection In in a new tab",
        voucherRefLabel: "RIN Number",
        voucherDateLabel: "Return Date",
        showVoucherRef: true,
        showVoucherDate: true,
        showPaymentTerms: false,
        showPaymentBlock: false,
        linkParentType: "CHALLAN",
        linkParentLabel: "Link to Challan / Sale",
        showShowPricesToggle: false,
    },
    REJECTION_OUT: {
        title: "Rejection Out",
        party: "Sundry Creditors",
        partyPlaceholder: "Search supplier by name or phone…",
        ratePick: (p) => p.costPrice,
        refLabel: "Original Ref", refDateLabel: "Original Ref Date",
        listPath: "/office/accountancy/vouchers-registers/rejections-out",
        nextRefType: "REJECTION_OUT",
        showProfit: false,
        cashLedgerLabel: "—",
        narrationFallback: (n) => n ? `Goods rejected to ${n}` : "Rejection Out",
        successPostedMsg: "Rejection Out posted — stock decremented",
        successDraftMsg:  "Rejection Out saved as draft",
        newButtonLabel: "New Rejection Out",
        closeRouteLabel: "Open another Rejection Out in a new tab",
        voucherRefLabel: "ROUT Number",
        voucherDateLabel: "Return Date",
        showVoucherRef: true,
        showVoucherDate: true,
        showPaymentTerms: false,
        showPaymentBlock: false,
        linkParentType: "GRN",
        linkParentLabel: "Link to GRN / Purchase",
        showShowPricesToggle: false,
    },
    // PREVIEW MIGRATION — Estimate / Quotation. Trading-voucher shape (item
    // table, party picker), but no GL post and no stock movement on POST
    // (server gates ESTIMATE out of both posting paths). Used by the
    // /office/accountancy/preview-vouchers/estimate route.
    ESTIMATE: {
        title: "Estimate / Quotation",
        party: "Sundry Debtors",
        partyPlaceholder: "Search customer by name or phone…",
        ratePick: (p) => p.salePrice,
        refLabel: null, refDateLabel: "",
        listPath: "/office/accountancy/vouchers-registers/estimates",
        nextRefType: "ESTIMATE",
        showProfit: true,
        cashLedgerLabel: "—",
        narrationFallback: (n) => n ? `Estimate for ${n}` : "Estimate",
        successPostedMsg: "Estimate saved",
        successDraftMsg:  "Estimate saved as draft",
        newButtonLabel: "New Estimate",
        closeRouteLabel: "Open another Estimate in a new tab",
        voucherRefLabel: "Estimate No",
        voucherDateLabel: "Estimate Date",
        showVoucherRef: true,
        showVoucherDate: true,
        showPaymentTerms: false,
        showPaymentBlock: false,
        linkParentType: null, linkParentLabel: null,
        showShowPricesToggle: false,
    },
};
