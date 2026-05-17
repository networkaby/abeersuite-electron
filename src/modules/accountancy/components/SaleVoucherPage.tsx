"use client";

/**
 * Full-page Sale Voucher — fresh implementation at /sale that matches the
 * reference Indian-SMB layout (Vyapar / Marg style):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Sale Voucher  [CASH | CREDIT]                              [X]   │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ Party search          Phone display     Invoice # SV-2026-…      │
 *   │ Narration                                Invoice Date  …         │
 *   │                                          Payment Terms  …(CRED)  │
 *   │                                          Due Date       …(CRED)  │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ # ITEM     MRP QTY FREE UNIT PRICE DISC %/₹ TAX %/₹ AMOUNT       │
 *   │ ─────────────────────────────────────────────────────────────────│
 *   │ + Add Item                                                       │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ Add Description    Add Image    Add Document │  Subtotal         │
 *   │ Payment Type [Cash ▾]                        │  Discount         │
 *   │                                              │  Shipping         │
 *   │                                              │  Round Off Total  │
 *   │                                              │  Received Balance │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │            Cancel  Show Profit  Save Draft  Save & Print  Save   │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Reuses calc + payload machinery from TradingVoucherFullScreenForm but
 * dropped the Dialog wrapper, picked a wider table grid, and split the
 * header into label-value rows on the right to match the reference.
 */
/* dont use number input type use text input type and validate to allow only numbers */

import { Fragment, useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { getOrgDefaults } from "@/shared/lib/orgDefaults";
import { useActiveBranchStore } from "@/store/activeBranchStore";
import { toast } from "sonner";
import {
    Loader2, Trash2, Plus, StickyNote, Settings2, X,
    Image as ImageIcon, FileText, ScanLine, Link2, ExternalLink,
    CopyPlus, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
    DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { InvProductCombobox, type SelectedProduct } from "@/modules/inventory/components/InvProductCombobox";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { ParentVoucherPicker } from "@/modules/inventory/components/ParentVoucherPicker";
import { Switch } from "@/components/ui/switch";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { fmt } from "@/utils/constants";

// ── Per-line state ─────────────────────────────────────────────────────────

type LineState = {
    id: number;
    product: SelectedProduct | null;
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
const newLine = (): LineState => ({
    id: ++lineSeq,
    product: null,
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

type CalcOpts = { applyDiscount?: boolean; applyTax?: boolean; rateInclTax?: boolean };
function calcLine(l: LineState, opts: CalcOpts = {}) {
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
    return { gross, discAmt, taxAmt, amount: taxable + taxAmt };
}


// Numeric input sanitizers — type="text" lets us avoid the awful native
// number-spinner UI; we filter keystrokes to digits + a single decimal
// point. `numSigned` additionally permits a leading minus (used for
// round-off which can legitimately be negative).
function num(s: string): string {
    // Strip non-numeric, collapse multiple decimal points to one.
    return s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}
function numSigned(s: string): string {
    const sign = s.trimStart().startsWith("-") ? "-" : "";
    return sign + num(s);
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

type KindConfig = {
    title:            string;
    party:            "Sundry Debtors" | "Sundry Creditors";
    partyPlaceholder: string;
    ratePick:         (p: SelectedProduct) => number | null | undefined;
    /// null → no Bill/Original-Invoice field on the form
    refLabel:         string | null;
    refDateLabel:     string;
    listPath:         string;
    nextRefType:      TradingKind;
    showProfit:       boolean;
    showPrint:        boolean;
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
    /// "Save & Print" voucher kinds — sale invoice, sale return, plus delivery
    /// challan. Print template itself ships per kind elsewhere.
    /// (Already covered by `showPrint` above; kept for backward compatibility.)
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

const PER_KIND: Record<TradingKind, KindConfig> = {
    SALE: {
        title: "Sale Invoice",
        party: "Sundry Debtors",
        partyPlaceholder: "Search customer by name or phone…",
        ratePick: (p) => p.salePrice,
        refLabel: null, refDateLabel: "",
        listPath: "/office/accountancy/vouchers-registers/sales",
        nextRefType: "SALE",
        showProfit: true, showPrint: true,
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
        showProfit: false, showPrint: false,
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
        listPath: "/office/accountancy/vouchers-registers/sale-returns",
        nextRefType: "SALE_RETURN",
        showProfit: false, showPrint: true,
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
        listPath: "/office/accountancy/vouchers-registers/purchase-returns",
        nextRefType: "PURCHASE_RETURN",
        showProfit: false, showPrint: false,
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
        showProfit: true, showPrint: false,
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
        showProfit: false, showPrint: false,
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
        showProfit: false, showPrint: false,
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
        listPath: "/office/accountancy/vouchers-registers/challans",
        nextRefType: "CHALLAN",
        showProfit: false, showPrint: false,
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
        showProfit: false, showPrint: false,
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
        showProfit: false, showPrint: false,
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
        showProfit: true, showPrint: true,
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

// ── Component ──────────────────────────────────────────────────────────────

function SaleVoucherPageInner({ kind = "SALE" }: { kind?: TradingKind } = {}) {
    const copy = PER_KIND[kind];
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeBranchId = useActiveBranchStore((s) => s.activeBranchId);
    const today = new Date().toISOString().slice(0, 10);

    // Edit mode: /sale?voucherId=4 → fetch the voucher, prefill the form,
    // PATCH on save. Set once on mount and locked in; subsequent param
    // changes do not retrigger the fetch (would discard user edits).
    const voucherIdParam = searchParams.get("voucherId");
    const editVoucherId = voucherIdParam ? Number(voucherIdParam) : null;
    const isEditing = editVoucherId != null && Number.isFinite(editVoucherId);
    const [editLoading, setEditLoading] = useState(isEditing);
    const [editingRef, setEditingRef] = useState<string | null>(null);
    // Whether the voucher being edited is already POSTED — drives the
    // "saving will reverse + re-post" warning and skips the explicit POST
    // /post step on Save (server's PATCH already re-posts atomically).
    const [editingWasPosted, setEditingWasPosted] = useState(false);
    // Voucher's saved paymentAccountId — paired with cashBankAccounts via a
    // dedicated effect so the picker resolves once both have loaded.
    const [pendingPaymentAccountId, setPendingPaymentAccountId] = useState<number | null>(null);

    const [saving, setSaving] = useState(false);
    const [lines, setLines] = useState<LineState[]>([newLine()]);
    // CREDIT is the default — most sales need a party on file so the
    // outstanding can be tracked. CASH is the walk-in / counter mode.
    // Non-GL kinds (orders, GRN, challan, rejections) keep CREDIT — they don't
    // render the CASH pill, so payMode never toggles for them.
    const [payMode, setPayMode] = useState<"CREDIT" | "CASH">("CREDIT");
    // Parent voucher linkage (GRN→PO, Challan→SO, etc.) — saved as
    // refVoucherId on the InvVoucher row. Picker only renders when
    // copy.linkParentType is set.
    const [parentLink, setParentLink] = useState<{ id: number; reference: string } | null>(null);
    // Challan-only print toggle. Persisted as InvVoucher.showPrices and read
    // back by the print job (deferred — see plan TODO).
    const [showPricesOnPrint, setShowPricesOnPrint] = useState(true);
    const [party, setParty] = useState<PickedParty | null>(null);
    const partyPickerRef = useRef<PartySearchAndCreateHandle>(null);
    // CASH walk-in fields — free-form name + phone. Stored on the voucher as
    // partyName / partyPhone strings only; no Person / Account row is created.
    const [walkInName, setWalkInName] = useState("");
    const [walkInPhone, setWalkInPhone] = useState("");
    // Picked-party snapshot — outstanding balance + address fetched on pick.
    const [partySnapshot, setPartySnapshot] = useState<{ balance: number; address: string | null }>({ balance: 0, address: null });
    // Cash / Bank ledger picker — which Account row receives the payment.
    // null = backend falls back to the legacy name-based "Cash-in-Hand" lookup.
    const [paymentAccount, setPaymentAccount] = useState<GlAccount | null>(null);
    const [cashBankAccounts, setCashBankAccounts] = useState<GlAccount[]>([]);
    const [header, setHeader] = useState({
        date: today,
        description: "",
        shippingAmt: "",
        roundOff: "",
        received: "",
        // Blank by default — user fills as needed. Pre-zeroes were noisy.
        discountPct: "",
        discountAmt: "",
        creditPeriodDays: "",
        // Bill / original-invoice reference — used by PURCHASE, SALE_RETURN,
        // PURCHASE_RETURN. SALE doesn't render the field, leaves these blank.
        refNumber: "",
        refDate: "",
    });

    // Invoice number preview (race-safe ±1 at concurrent save). In edit
    // mode the voucher's own reference is shown instead — see editingRef.
    const [nextRef, setNextRef] = useState("");
    useEffect(() => {
        if (isEditing) return;
        axios.get<{ reference: string }>(`/api/inventory/vouchers/next-ref?type=${copy.nextRefType}`)
            .then((r) => setNextRef(r.data.reference))
            .catch(() => setNextRef(""));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing]);

    // Pre-fill credit period from OrgDefaults on new vouchers (create mode only).
    useEffect(() => {
        if (isEditing || !copy.showPaymentTerms) return;
        getOrgDefaults()
            .then((d) => {
                const days = kind === "PURCHASE"
                    ? d.defaultPurchaseCreditPeriod
                    : d.defaultSaleCreditPeriod;
                if (days == null) return;
                setHeader((h) => ({ ...h, creditPeriodDays: String(days) }));
            })
            .catch(() => {/* silent — defaults are optional */});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing]);

    // ── Edit mode: fetch the voucher and prefill all form state ──────────
    // Run once on mount when `?voucherId=` is set. The fetch payload is the
    // standard GET /api/inventory/vouchers/[id] response (header + lines +
    // product info). Anything we can't fully reconstruct (party-table
    // snapshot, product cost / sale prices for line rate auto-fill) is
    // stubbed with null — the user can still hand-edit any cell.
    useEffect(() => {
        if (!isEditing || editVoucherId == null) return;
        let cancelled = false;
        axios.get<{
            id: number;
            reference: string;
            date: string;
            status: string;
            description: string;
            partyName: string | null;
            partyType: string | null;
            partyId: number | null;
            partyPhone: string | null;
            partyAddress: string | null;
            paymentMode: string | null;
            paymentAccountId: number | null;
            creditPeriodDays: number | null;
            refNumber: string | null;
            refDate: string | null;
            refVoucherId: number | null;
            refVoucher?: { id: number; reference: string } | null;
            shippingAmt: string | number;
            roundOff: string | number;
            discountPct: string | number | null;
            discountAmt: string | number | null;
            amountReceived: string | number;
            showPrices?: boolean;
            lines: {
                id: number;
                productId: number;
                description: string | null;
                quantity: string | number;
                freeQty: string | number | null;
                rate: string | number;
                discountPct: string | number;
                discountAmt: string | number;
                taxRate: string | number;
                taxAmount: string | number;
                amount: string | number;
                product: { id: number; sku: string; name: string; unit: { code: string; label: string } };
            }[];
        }>(`/api/inventory/vouchers/${editVoucherId}`)
            .then((r) => {
                if (cancelled) return;
                const v = r.data;
                if (v.status === "CANCELLED") {
                    toast.error("This voucher is cancelled. Use Duplicate to create a fresh copy.");
                    router.push("/office/inventory/inventory-details");
                    return;
                }
                setEditingRef(v.reference);
                setEditingWasPosted(v.status === "POSTED");

                // Lines → LineState mapping. Stub salePrice / costPrice as
                // null on the SelectedProduct stub; rate auto-fill only
                // triggers on fresh product selects, so this is safe.
                const fmtNum = (x: string | number | null | undefined): string => {
                    if (x == null) return "";
                    const n = typeof x === "string" ? parseFloat(x) : x;
                    if (!Number.isFinite(n) || n === 0) return "";
                    return String(n);
                };
                setLines(v.lines.length === 0 ? [newLine()] : v.lines.map((l) => ({
                    id: ++lineSeq,
                    product: {
                        id: l.product.id,
                        sku: l.product.sku,
                        name: l.product.name,
                        unitCode: l.product.unit.code,
                        stock: null,
                        salePrice: null,
                        costPrice: null,
                        mrp: null,
                    },
                    quantity: String(typeof l.quantity === "string" ? parseFloat(l.quantity) : l.quantity),
                    freeQty: fmtNum(l.freeQty),
                    rate: String(typeof l.rate === "string" ? parseFloat(l.rate) : l.rate),
                    // Restore MRP from the saved line (mrpPaise → ₹).
                    mrpRupees: (l as { mrpPaise?: number | null }).mrpPaise != null
                        ? String(((l as { mrpPaise?: number | null }).mrpPaise as number) / 100)
                        : "",
                    discountPct: fmtNum(l.discountPct),
                    discountAmt: fmtNum(l.discountAmt),
                    taxRate: fmtNum(l.taxRate),
                    taxAmount: fmtNum(l.taxAmount),
                    amountInput: "",
                    description: l.description ?? "",
                    showDescription: !!l.description,
                })));

                setPayMode(v.paymentMode === "CASH" ? "CASH" : "CREDIT");
                if (v.paymentAccountId != null) setPendingPaymentAccountId(v.paymentAccountId);

                // Party prefill — for CREDIT we set the picker via its handle;
                // for CASH the walk-in fields take it. We populate both sides
                // so the form re-renders without a re-fetch.
                if (v.paymentMode === "CASH") {
                    setWalkInName(v.partyName ?? "");
                    setWalkInPhone(v.partyPhone ?? "");
                } else if (v.partyId != null && v.partyType) {
                    setParty({
                        id: v.partyId,
                        kind: (v.partyType === "customer" || v.partyType === "supplier" || v.partyType === "company")
                            ? v.partyType
                            : "customer",
                        name: v.partyName ?? "",
                        phone: v.partyPhone ?? null,
                    } as PickedParty);
                }

                const overallDiscAmt = v.discountAmt != null ? Number(v.discountAmt) : 0;
                const overallDiscPct = v.discountPct != null ? Number(v.discountPct) : 0;
                const roundOff = Number(v.roundOff ?? 0);
                setEnableRoundOff(Math.abs(roundOff) > 0.005);
                setRoundOffManuallyEdited(Math.abs(roundOff) > 0.005);
                setHeader({
                    date: v.date ? v.date.slice(0, 10) : today,
                    description: v.description ?? "",
                    shippingAmt: Number(v.shippingAmt ?? 0) > 0 ? String(Number(v.shippingAmt)) : "",
                    roundOff: Math.abs(roundOff) > 0.005 ? roundOff.toFixed(2) : "",
                    received: Number(v.amountReceived ?? 0) > 0 ? String(Number(v.amountReceived)) : "",
                    discountPct: overallDiscPct > 0 ? String(overallDiscPct) : "",
                    discountAmt: overallDiscAmt > 0 ? String(overallDiscAmt) : "",
                    creditPeriodDays: v.creditPeriodDays != null ? String(v.creditPeriodDays) : "",
                    refNumber: v.refNumber ?? "",
                    refDate: v.refDate ? v.refDate.slice(0, 10) : "",
                });
                if (v.refVoucherId && v.refVoucher) {
                    setParentLink({ id: v.refVoucherId, reference: v.refVoucher.reference });
                }
                if (typeof v.showPrices === "boolean") setShowPricesOnPrint(v.showPrices);
            })
            .catch(() => {
                if (cancelled) return;
                toast.error("Failed to load voucher for editing");
                router.push("/office/inventory/inventory-details");
            })
            .finally(() => { if (!cancelled) setEditLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editVoucherId, isEditing]);

    // Load cash + bank ledgers once and pre-select "Cash-in-Hand" if present.
    // Same fetch as MoneyFlowDialog — Account rows enriched with their group
    // so we can filter by ACCOUNT_GROUPS.CASH_IN_HAND / BANK_ACCOUNTS.
    // In edit mode the default is skipped — a separate effect matches the
    // voucher's saved paymentAccountId once both fetches resolve.
    useEffect(() => {
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=false")
            .then((r) => {
                const cb = r.data.filter((a) =>
                    a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND ||
                    a.group?.name === ACCOUNT_GROUPS.BANK_ACCOUNTS,
                );
                setCashBankAccounts(cb);
                if (isEditing) return;
                // Default to "Cash-in-Hand" if available, else first hit.
                if (!paymentAccount) {
                    const cash = cb.find((a) => a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND);
                    setPaymentAccount(cash ?? cb[0] ?? null);
                }
            })
            .catch(() => setCashBankAccounts([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Edit-mode payment-account resolver: when both the loaded voucher's
    // paymentAccountId and the cash/bank list are available, pick the match.
    useEffect(() => {
        if (!isEditing) return;
        if (pendingPaymentAccountId == null) return;
        if (cashBankAccounts.length === 0) return;
        const match = cashBankAccounts.find((a) => a.id === pendingPaymentAccountId);
        if (match) setPaymentAccount(match);
    }, [isEditing, pendingPaymentAccountId, cashBankAccounts]);

    // Fetch the picked party's outstanding balance + address so we can show
    // them in the compact info card. accountId / id come straight off
    // PickedParty; we don't need to refetch the name / phone.
    useEffect(() => {
        if (!party) { setPartySnapshot({ balance: 0, address: null }); return; }
        if (party.kind !== "customer") {
            // Companies (B2B) — skip the call for now; could be wired later.
            setPartySnapshot({ balance: 0, address: null });
            return;
        }
        let cancelled = false;
        axios.get<{ address: string | null; account?: { balance: number | string | null } }>(`/api/person/${party.id}`)
            .then((r) => {
                if (cancelled) return;
                const raw = r.data.account?.balance;
                const balance = typeof raw === "string" ? parseFloat(raw) : (raw ?? 0);
                setPartySnapshot({ balance: balance || 0, address: r.data.address ?? null });
            })
            .catch(() => { if (!cancelled) setPartySnapshot({ balance: 0, address: null }); });
        return () => { cancelled = true; };
    }, [party]);

    const [showProfit, setShowProfit] = useState(false);
    const [showDescription, setShowDescription] = useState(false);
    // Round Off is optional (Vyapar pattern): unchecked → hidden + treated as 0.
    // When the checkbox is ticked, the value AUTO-computes to whatever brings
    // Total to the nearest whole rupee (Math.round(preRound) - preRound). If
    // the user types into the input directly, we flip `roundOffManuallyEdited`
    // and stop auto-recomputing so the manual override sticks.
    const [enableRoundOff, setEnableRoundOff] = useState(false);
    const [roundOffManuallyEdited, setRoundOffManuallyEdited] = useState(false);

    // ── Column / feature visibility (persisted) ───────────────────────────
    type ColumnPrefs = {
        freeQty: boolean;
        mrpHint: boolean;
        lineDiscount: boolean;
        lineTax: boolean;
        lineDescription: boolean;
        overallDiscount: boolean;
        /// true = PRICE column shows/accepts tax-inclusive rate;
        /// false (default) = exclusive. On PURCHASE the MRP column is always
        /// editable regardless of this toggle.
        rateInclTax: boolean;
    };
    const DEFAULT_PREFS: ColumnPrefs = {
        freeQty: true,
        mrpHint: true,
        lineDiscount: true,
        lineTax: true,
        lineDescription: true,
        overallDiscount: true,
        rateInclTax: false,
    };
    // Bumped to v2 when rateInclTax was added — clears stale v1 cache.
    const PREFS_KEY = "saleVoucherPage.columnPrefs.v2";
    const [prefs, setPrefs] = useState<ColumnPrefs>(DEFAULT_PREFS);
    const prefsRef = useRef<ColumnPrefs>(DEFAULT_PREFS);
    useEffect(() => { prefsRef.current = prefs; });
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(PREFS_KEY);
            if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
        } catch { /* ignore */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const togglePref = (k: keyof ColumnPrefs) => {
        setPrefs((p) => {
            const next = { ...p, [k]: !p[k] };
            try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); }
            catch { /* ignore */ }
            return next;
        });
    };

    // Toggling rateInclTax flips how the entered PRICE is interpreted: the
    // user's typed number stays as-is, but the AMOUNT column re-derives.
    // Without resyncing taxAmount, calcLine would keep the previous mode's
    // stale value and the total would drift.
    const toggleRateInclTax = () => {
        const willBeInclusive = !prefs.rateInclTax;
        setPrefs((p) => {
            const next = { ...p, rateInclTax: !p.rateInclTax };
            try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); }
            catch { /* ignore */ }
            return next;
        });
        setLines((ls) => ls.map((l) => {
            const rawRate = parseFloat(l.rate) || 0;
            if (rawRate === 0) return l;
            const tRate = parseFloat(l.taxRate) || 0;
            if (tRate === 0) return l; // tax-free — taxAmount stays ""
            const factor = 1 + tRate / 100;
            const exclusiveRate = willBeInclusive ? rawRate / factor : rawRate;
            const qty = parseFloat(l.quantity) || 0;
            const discAmt = parseFloat(l.discountAmt) || 0;
            const taxable = qty * exclusiveRate - discAmt;
            const newTaxAmt = taxable * (tRate / 100);
            return {
                ...l,
                taxAmount: newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "",
            };
        }));
    };

    // ── Line edit helpers (paired %/₹) ────────────────────────────────────
    const updateLine = (id: number, patch: Partial<LineState>) =>
        setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const removeLine = (id: number) => setLines((ls) => ls.filter((l) => l.id !== id));
    const addLine = () => setLines((ls) => [...ls, newLine()]);

    // Recompute helpers — when the derived value is zero we write "" so the
    // cell stays blank (no noisy "0.00" prefills). The other recompute
    // functions delegate to this for tax.
    const withTaxFromRate = (l: LineState): LineState => {
        const rawRate = parseFloat(l.rate) || 0;
        const tRate = parseFloat(l.taxRate) || 0;
        // Derive the exclusive rate when operating in inclusive-rate mode.
        const rate = prefs.rateInclTax && tRate > 0 ? rawRate / (1 + tRate / 100) : rawRate;
        const gross = (parseFloat(l.quantity) || 0) * rate;
        const discAmt = parseFloat(l.discountAmt) || 0;
        const taxable = gross - discAmt;
        const newTaxAmt = taxable * (tRate / 100);
        return { ...l, taxAmount: newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "" };
    };
    const setLineDiscountPct = (id: number, pct: string) => setLines((ls) => ls.map((l) => {
        if (l.id !== id) return l;
        const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
        const p = parseFloat(pct) || 0;
        const amt = gross * (p / 100);
        return withTaxFromRate({ ...l, discountPct: pct, discountAmt: amt > 0 ? amt.toFixed(2) : "" });
    }));
    const setLineDiscountAmt = (id: number, amt: string) => setLines((ls) => ls.map((l) => {
        if (l.id !== id) return l;
        const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
        const a = parseFloat(amt) || 0;
        const pct = gross > 0 ? (a / gross) * 100 : 0;
        return withTaxFromRate({ ...l, discountAmt: amt, discountPct: pct > 0 ? pct.toFixed(2) : "" });
    }));
    const setLineTaxRate = (id: number, rate: string) => setLines((ls) => ls.map((l) => {
        if (l.id !== id) return l;
        return withTaxFromRate({ ...l, taxRate: rate });
    }));
    const setLineTaxAmount = (id: number, amt: string) => setLines((ls) => ls.map((l) => {
        if (l.id !== id) return l;
        const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
        const discAmt = parseFloat(l.discountAmt) || 0;
        const taxable = gross - discAmt;
        const a = parseFloat(amt) || 0;
        const r = taxable > 0 ? (a / taxable) * 100 : 0;
        return { ...l, taxAmount: amt, taxRate: r > 0 ? r.toFixed(2) : "" };
    }));
    const setLineAmount = (id: number, amt: string) => setLines((ls) => ls.map((l) => {
        if (l.id !== id) return l;
        const a = parseFloat(amt) || 0;
        const qty = parseFloat(l.quantity) || 1;
        const tRate = parseFloat(l.taxRate) || 0;
        // exclusive: amount = qty * rate * (1 + tax/100) → rate = amount / (qty * (1 + tax/100))
        // inclusive: amount = qty * inclusiveRate → inclusiveRate = amount / qty
        const newRate = prefs.rateInclTax && tRate > 0
            ? a / qty
            : (tRate > 0 ? a / (qty * (1 + tRate / 100)) : a / qty);
        return withTaxFromRate({ ...l, rate: newRate > 0 ? String(Number(newRate.toFixed(6))) : "", amountInput: amt });
    }));
    const setLineQtyOrRate = (id: number, patch: { quantity?: string; rate?: string }) =>
        setLines((ls) => ls.map((l) => {
            if (l.id !== id) return l;
            const next = { ...l, ...patch };
            const rawRate = parseFloat(next.rate) || 0;
            const tRate = parseFloat(next.taxRate) || 0;
            // Use exclusive rate for discount computation regardless of display mode.
            const rate = prefs.rateInclTax && tRate > 0 ? rawRate / (1 + tRate / 100) : rawRate;
            const gross = (parseFloat(next.quantity) || 0) * rate;
            const dPct = parseFloat(next.discountPct) || 0;
            const newDiscAmt = gross * (dPct / 100);
            return withTaxFromRate({
                ...next,
                discountAmt: newDiscAmt > 0 ? newDiscAmt.toFixed(2) : "",
            });
        }));

    const handleProductSelect = useCallback((lineId_: number, product: SelectedProduct | null) => {
        setLines((ls) => {
            const updated = ls.map((l) => {
                if (l.id !== lineId_) return l;
                const fillRate = product ? copy.ratePick(product) : null;
                const nextRate = fillRate != null ? String(fillRate) : l.rate;
                // MRP: auto-fill from product master (in ₹). Preserved if product has no MRP.
                const nextMrp = product?.mrp != null && product.mrp > 0
                    ? String(product.mrp)
                    : l.mrpRupees;
                const tRate = parseFloat(l.taxRate) || 0;
                const rateInclTax = prefsRef.current.rateInclTax;
                const parsedRate = parseFloat(nextRate) || 0;
                const exclusiveRate = rateInclTax && tRate > 0 ? parsedRate / (1 + tRate / 100) : parsedRate;
                const gross = (parseFloat(l.quantity) || 0) * exclusiveRate;
                const dPct = parseFloat(l.discountPct) || 0;
                const newDiscAmt = gross * (dPct / 100);
                const taxable = gross - newDiscAmt;
                const newTaxAmt = taxable * (tRate / 100);
                return {
                    ...l, product, rate: nextRate, mrpRupees: nextMrp,
                    discountAmt: newDiscAmt > 0 ? newDiscAmt.toFixed(2) : "",
                    taxAmount: newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "",
                };
            });
            // Auto-append a blank row when a product is picked on the last line,
            // so the user can keep adding items without clicking "Add Row".
            // Guard: only when a product is set (not cleared) and it's truly the last row.
            if (product && ls[ls.length - 1]?.id === lineId_) {
                return [...updated, newLine()];
            }
            return updated;
        });
        // Cascade GST prefill: resolve effective tax from product → group → org-default,
        // then snapshot onto the line's taxRate. User can override after.
        if (product) {
            axios
                .get<{ gstRate: number | null }>(`/api/inventory/products/${product.id}/resolved-tax`)
                .then(({ data }) => {
                    if (data.gstRate == null) return;
                    const resolvedRate = String(data.gstRate);
                    setLines((ls) => ls.map((l) => {
                        if (l.id !== lineId_) return l;
                        // Only apply if the user hasn't manually typed a rate already.
                        const existing = l.taxRate.trim();
                        if (existing !== "" && existing !== "0") return l;
                        const newTaxRate = resolvedRate;
                        const rateInclTax = prefsRef.current.rateInclTax;
                        const rawRate = parseFloat(l.rate) || 0;
                        const tRate = parseFloat(newTaxRate) || 0;
                        const exclusiveRate = rateInclTax && tRate > 0 ? rawRate / (1 + tRate / 100) : rawRate;
                        const gross = (parseFloat(l.quantity) || 0) * exclusiveRate;
                        const discAmt = parseFloat(l.discountAmt) || 0;
                        const taxable = gross - discAmt;
                        const newTaxAmt = taxable * (tRate / 100);
                        return { ...l, taxRate: newTaxRate, taxAmount: newTaxAmt > 0 ? newTaxAmt.toFixed(2) : "" };
                    }));
                })
                .catch(() => {/* non-fatal — user can set taxRate manually */});
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Totals ────────────────────────────────────────────────────────────
    const computed = lines.map((l) => calcLine(l, {
        applyDiscount: prefs.lineDiscount,
        applyTax: prefs.lineTax,
        rateInclTax: prefs.rateInclTax,
    }));
    const lineSubtotal = computed.reduce((s, c) => s + c.amount, 0);
    const totalQty = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);
    const totalFreeQty = lines.reduce((s, l) => s + (parseFloat(l.freeQty) || 0), 0);
    const totalDisc = computed.reduce((s, c) => s + c.discAmt, 0);
    const totalTax = computed.reduce((s, c) => s + c.taxAmt, 0);
    const shipping = parseFloat(header.shippingAmt) || 0;
    const overallDiscount = prefs.overallDiscount ? (parseFloat(header.discountAmt) || 0) : 0;
    const roundOff = enableRoundOff ? (parseFloat(header.roundOff) || 0) : 0;
    const grandTotal = lineSubtotal - overallDiscount + shipping + roundOff;
    const received = parseFloat(header.received) || 0;
    const balance = grandTotal - received;

    // Auto round-off: when the checkbox is ticked and the user hasn't typed
    // a manual override, derive header.roundOff so Total lands on a whole
    // rupee. `preRound` excludes the round-off itself to avoid feedback.
    useEffect(() => {
        if (!enableRoundOff || roundOffManuallyEdited) return;
        const preRound = lineSubtotal - overallDiscount + shipping;
        const target = Math.round(preRound);
        const auto = target - preRound;
        // Only write when the result actually changes — prevents update churn.
        const formatted = Math.abs(auto) < 0.005 ? "0" : auto.toFixed(2);
        if (formatted !== header.roundOff) {
            setHeader((h) => ({ ...h, roundOff: formatted }));
        }
    }, [enableRoundOff, roundOffManuallyEdited, lineSubtotal, overallDiscount, shipping, header.roundOff]);

    const handleDiscountPctChange = (pct: string) => {
        const p = parseFloat(pct) || 0;
        const amt = (lineSubtotal * p) / 100;
        setHeader((h) => ({ ...h, discountPct: pct, discountAmt: amt > 0 ? amt.toFixed(2) : "" }));
    };
    const handleDiscountAmtChange = (amt: string) => {
        const a = parseFloat(amt) || 0;
        const pct = lineSubtotal > 0 ? (a / lineSubtotal) * 100 : 0;
        setHeader((h) => ({ ...h, discountAmt: amt, discountPct: pct > 0 ? pct.toFixed(2) : "" }));
    };

    // Live profit
    const lineProfits = lines.map((l) => {
        const qty = parseFloat(l.quantity) || 0;
        const rate = parseFloat(l.rate) || 0;
        const cost = l.product?.costPrice ?? 0;
        const disc = prefs.lineDiscount ? (parseFloat(l.discountAmt) || 0) : 0;
        const gross = qty * rate;
        const revenue = gross - disc;
        const costTotal = qty * cost;
        return { id: l.id, name: l.product?.name ?? "—", qty, cost, revenue, profit: revenue - costTotal };
    });
    const totalLineProfit = lineProfits.reduce((s, p) => s + p.profit, 0);
    const estimatedProfit = totalLineProfit - overallDiscount;
    const margin = grandTotal > 0 ? (estimatedProfit / grandTotal) * 100 : 0;

    const reset = () => {
        setLines([newLine()]);
        setPayMode("CREDIT");
        setParty(null);
        setWalkInName("");
        setWalkInPhone("");
        setPartySnapshot({ balance: 0, address: null });
        // Re-select "Cash-in-Hand" default so the picker is ready for the next sale.
        const cash = cashBankAccounts.find((a) => a.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND);
        setPaymentAccount(cash ?? cashBankAccounts[0] ?? null);
        partyPickerRef.current?.clear();
        const t = new Date().toISOString().slice(0, 10);
        setHeader({
            date: t, description: "", shippingAmt: "", roundOff: "", received: "",
            discountPct: "", discountAmt: "",
            creditPeriodDays: "",
            refNumber: "", refDate: "",
        });
        setShowProfit(false);
        setShowDescription(false);
        setEnableRoundOff(false);
        setRoundOffManuallyEdited(false);
        setParentLink(null);
        setShowPricesOnPrint(true);
    };

    const submit = async (andPost = false, andPrint = false) => {
        // CREDIT mode: party is required so the receivable lands on a real ledger.
        // CASH mode: party optional — walk-in name / phone are recorded as free
        //            text on the voucher only, no Person / Account is created.
        if (payMode === "CREDIT" && !party) {
            toast.error("Pick or create a party for a credit sale");
            return;
        }
        const validLines = lines.filter((l) => l.product && parseFloat(l.quantity) > 0);
        if (!validLines.length) {
            toast.error("Add at least one item with a product and quantity");
            return;
        }
        if (copy.refLabel) {
            if (!header.refNumber.trim()) {
                toast.error(`${copy.refLabel} is required`);
                return;
            }
            if (!header.refDate) {
                toast.error(`${copy.refDateLabel} is required`);
                return;
            }
        }
        const displayName = payMode === "CREDIT" ? party?.name : (walkInName.trim() || undefined);
        const description = header.description.trim() || copy.narrationFallback(displayName);

        // CASH mode auto-pays in full (received = grand total). User can still
        // override via the Received field — but the default mirrors counter sales.
        const receivedForPayload = payMode === "CASH"
            ? ((parseFloat(header.received) || 0) > 0 ? (parseFloat(header.received) || 0) : grandTotal)
            : received;

        setSaving(true);
        try {
            // Purchase hides the Invoice Date input; the Bill Date (refDate)
                // is the user-facing date and drives voucher.date on save.
                // Falls back to today's date if neither is set.
            const voucherDate = copy.showVoucherDate
                ? header.date
                : (header.refDate || header.date);
            const payload = {
                type: kind,
                branchId: activeBranchId ?? undefined,
                date: voucherDate,
                description,
                partyName: payMode === "CREDIT" ? (party?.name || undefined)
                    : (walkInName.trim() || undefined),
                partyPhone: payMode === "CREDIT" ? (party?.phone || undefined)
                    : (walkInPhone.trim() || undefined),
                // partyType / partyId only carried in CREDIT mode — CASH stays
                // free-text so the ledger isn't accidentally cluttered.
                partyType: payMode === "CREDIT" ? party?.kind : undefined,
                partyId: payMode === "CREDIT" ? party?.id : undefined,
                paymentMode: payMode,
                // Cash / bank ledger that the payment lands on. Only relevant
                // when money actually changes hands at the till: every CASH sale,
                // OR a CREDIT sale with an upfront Received amount.
                paymentAccountId: (payMode === "CASH" || receivedForPayload > 0)
                    ? paymentAccount?.id
                    : undefined,
                ...(copy.showPaymentTerms && payMode === "CREDIT" ? {
                    creditPeriodDays: header.creditPeriodDays ? Number(header.creditPeriodDays) : undefined,
                } : {}),
                // Bill / original-invoice ref (only rendered for kinds with refLabel
                // — Purchase, Sale Return, Purchase Return).
                ...(copy.refLabel ? {
                    refNumber: header.refNumber.trim() || undefined,
                    refDate:   header.refDate || undefined,
                } : {}),
                // Parent voucher link (GRN→PO, Challan→SO, Rejection→Sale/GRN).
                ...(parentLink ? { refVoucherId: parentLink.id } : {}),
                // Challan-only print toggle.
                ...(copy.showShowPricesToggle ? { showPrices: showPricesOnPrint } : {}),
                shippingAmt: shipping,
                roundOff,
                discountPct: prefs.overallDiscount ? (parseFloat(header.discountPct) || 0) : 0,
                discountAmt: overallDiscount,
                amountReceived: receivedForPayload,
                lines: validLines.map((l) => {
                    const rawRate = parseFloat(l.rate) || 0;
                    const tRate = prefs.lineTax ? (parseFloat(l.taxRate) || 0) : 0;
                    // DB always stores the exclusive rate. When the form is in
                    // tax-inclusive mode, back-calculate before saving.
                    const exclusiveRate = prefs.rateInclTax && tRate > 0
                        ? rawRate / (1 + tRate / 100)
                        : rawRate;
                    // MRP in paise — only sent when the user has entered a value.
                    const mrpPaiseVal = l.mrpRupees.trim()
                        ? Math.round((parseFloat(l.mrpRupees) || 0) * 100)
                        : undefined;
                    return {
                        productId: l.product!.id,
                        description: prefs.lineDescription ? (l.description.trim() || undefined) : undefined,
                        quantity: parseFloat(l.quantity) || 1,
                        freeQty: prefs.freeQty ? (parseFloat(l.freeQty) || 0) : 0,
                        rate: exclusiveRate,
                        mrpPaise: mrpPaiseVal,
                        discountPct: prefs.lineDiscount ? (parseFloat(l.discountPct) || 0) : 0,
                        discountAmt: prefs.lineDiscount ? (parseFloat(l.discountAmt) || 0) : 0,
                        taxRate: tRate,
                    };
                }),
            };

            // Edit mode → PATCH the same voucher in place; create mode → POST.
            // The server's PATCH handles both DRAFT (simple update) and POSTED
            // (reverse + apply + re-post in a single transaction) so the
            // reference number is preserved across edits. Save & Print / Save
            // only need the explicit POST /post step when the voucher was a
            // DRAFT (or a fresh create) — POSTED-on-arrival edits are already
            // re-posted atomically by PATCH.
            let savedId: number;
            const skipExplicitPost = isEditing && editingWasPosted;
            if (isEditing && editVoucherId != null) {
                await axios.patch(`/api/inventory/vouchers/${editVoucherId}`, payload);
                savedId = editVoucherId;
            } else {
                const res = await axios.post<{ id: number }>("/api/inventory/vouchers", payload);
                savedId = res.data.id;
            }

            if (andPost && !skipExplicitPost) {
                await axios.post(`/api/inventory/vouchers/${savedId}/post`);
                toast.success(copy.successPostedMsg);
            } else if (andPost) {
                // PATCH already re-posted — surface the same success copy.
                toast.success(copy.successPostedMsg);
            } else {
                toast.success(copy.successDraftMsg);
            }
            if (andPrint) {
                window.open(`/receipt/invoice/${savedId}?autoprint=1`, "_blank", "noopener");
            }

            if (isEditing) {
                // Edit done — leave the form and let the user verify the row
                // updated wherever they came from.
                router.push("/office/inventory/inventory-details");
                return;
            }

            // Reset for the next transaction instead of navigating away —
            // the cashier can punch in the next sale without leaving /sale.
            // Cancel / Close X are the explicit exits to the list page.
            reset();
            // Re-fetch the invoice-number preview so the next sale shows
            // the freshly-incremented reference (otherwise nextRef would
            // stay stale until the next page mount).
            axios.get<{ reference: string }>(`/api/inventory/vouchers/next-ref?type=${copy.nextRefType}`)
                .then((r) => setNextRef(r.data.reference))
                .catch(() => { /* keep last value */ });
            router.refresh();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const cell = "bg-transparent border-0 outline-none text-sm text-right w-full focus:bg-accent/40 rounded px-1 tabular-nums";

    return (
        <div className="flex flex-col flex-1 min-h-0 bg-background">
            {/* ── Title bar ─────────────────────────────────────────────── */}
            <header className="border-b border-border bg-card px-6 py-2.5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <h1 className="text-base font-semibold">
                        {isEditing ? `Edit ${copy.title}` : copy.title}
                        {isEditing && editingRef && (
                            <span className="ml-2 font-mono text-xs text-muted-foreground">{editingRef}</span>
                        )}
                    </h1>
                    {isEditing && editingWasPosted && (
                        <span
                            className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-medium"
                            title="Saving will reverse this voucher's stock & GL impact and re-post with the new values. Reference number is preserved."
                        >
                            Posted — edit reposts on save
                        </span>
                    )}
                    {/* CASH / CREDIT pill — same shape as the dialog */}
                    {copy.showPaymentBlock && (
                        <div className="flex rounded-md border border-border overflow-hidden text-xs font-semibold">
                            {(["CASH", "CREDIT"] as const).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setPayMode(m)}
                                    className={`px-3 py-1 transition-colors ${payMode === m
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-card text-muted-foreground hover:bg-muted"
                                        }`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    )}
                    {/* Spawn another Sale Invoice in a fresh window — lets the
                        cashier work on parallel transactions without losing
                        the current draft. window.open uses noopener so the
                        new tab is independent. */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(window.location.pathname, "_blank", "noopener")}
                        title={copy.closeRouteLabel}
                        className="gap-1.5 text-muted-foreground hover:text-foreground"
                    >
                        {/* <ExternalLink size={14} /> */}
                        <CopyPlus size={14} /> {copy.newButtonLabel}
                    </Button>
                </div>
                <div className="flex items-center gap-2">
                    {activeBranchId && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground border border-border/60 rounded">
                            <Building2 size={12} className="shrink-0" />
                            <span>{activeBranchId}</span>
                        </div>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push(copy.listPath)}
                        title="Close"
                    >
                        <X size={18} />
                    </Button>
                </div>
            </header>

            {/* One page-wide ScrollArea wraps the form header, the item table
                and the totals footer so they scroll together — the title bar
                above and the action bar below stay pinned. Matches the
                reference Vyapar-style invoice page. */}
            <ScrollArea className="flex-1 min-h-0">

                {/* ── Form header: party (left) + invoice meta (right) ──────── */}
                <section className="border-b border-border bg-card px-6 py-4 grid grid-cols-[1fr_auto] gap-12">
                    {/* Left: party picker / walk-in inputs — depends on payMode.
                    CREDIT requires a ledgered party (Sundry Debtors); CASH
                    accepts a free-text name + phone for the printed receipt
                    without touching the Person / Account tables. */}
                    <div className="max-w-xl">
                        {payMode === "CREDIT" ? (
                            <>
                                <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                    Party <span className="text-destructive">*</span>
                                </label>
                                <div className="mt-1">
                                    <PartySearchAndCreate
                                        ref={partyPickerRef}
                                        onPicked={setParty}
                                        locked={!!party}
                                        placeholder={copy.partyPlaceholder}
                                        partyGroup={copy.party}
                                        allowIncludeOther
                                        defaultToCompany={copy.party === "Sundry Creditors"}
                                    />
                                </div>
                                {/* Picked-party compact info card — name, mobile, outstanding,
                                address. Address truncates with ellipsis to fit the area. */}
                                {party && (
                                    <div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 max-w-full">
                                        <div className="font-medium truncate">{party.name}</div>
                                        <button
                                            type="button"
                                            onClick={() => { setParty(null); partyPickerRef.current?.clear(); }}
                                            className="text-muted-foreground hover:text-foreground shrink-0 underline-offset-2 hover:underline"
                                            title="Clear party"
                                        >
                                            Clear &times;
                                        </button>
                                        <div className="text-muted-foreground tabular-nums truncate">
                                            {party.phone || "—"}
                                        </div>
                                        <div className={`tabular-nums font-semibold text-right shrink-0 ${partySnapshot.balance > 0 ? "text-destructive" : partySnapshot.balance < 0 ? "text-green-600" : "text-muted-foreground"}`}>
                                            {partySnapshot.balance !== 0
                                                ? `${partySnapshot.balance > 0 ? "Due" : "Credit"} ₹${fmt(Math.abs(partySnapshot.balance))}`
                                                : "No balance"}
                                        </div>
                                        {partySnapshot.address && (
                                            <div className="col-span-2 text-muted-foreground truncate" title={partySnapshot.address}>
                                                {partySnapshot.address}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                        Customer name <span className="text-muted-foreground/60 normal-case">(optional)</span>
                                    </label>
                                    <Input
                                        value={walkInName}
                                        onChange={(e) => setWalkInName(e.target.value)}
                                        placeholder="Walk-in"
                                        className="h-9 mt-1"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                        Mobile <span className="text-muted-foreground/60 normal-case">(optional)</span>
                                    </label>
                                    <Input
                                        value={walkInPhone}
                                        onChange={(e) => setWalkInPhone(e.target.value)}
                                        placeholder="—"
                                        inputMode="tel"
                                        className="h-9 mt-1 tabular-nums"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right: invoice meta — label / value grid */}
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm min-w-[340px] items-center">
                        {copy.showVoucherRef && (
                            <>
                                <label className="text-xs text-muted-foreground text-right">{copy.voucherRefLabel}</label>
                                {isEditing ? (
                                    <div className="border-0 outline-none focus:bg-accent/40 rounded px-2 py-1.5 text-sm font-mono tabular-nums w-44 bg-muted/50">
                                        {editingRef || (editLoading ? "Loading…" : "—")}
                                    </div>
                                ) : (
                                    <div className="font-mono text-xs tabular-nums px-2 py-1.5 rounded-md bg-muted/40 border border-border min-h-9 flex items-center">
                                        {nextRef || "Generating…"}
                                    </div>
                                )}
                            </>
                        )}

                        {copy.showVoucherDate && (
                            <>
                                <label className="text-xs text-muted-foreground text-right">{copy.voucherDateLabel}</label>
                                <Input
                                    type="date"
                                    value={header.date}
                                    onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
                                    className="h-9 text-xs"
                                />
                            </>
                        )}

                        {/* Bill / Original-Invoice reference — Purchase has the
                            supplier's bill number; Sale Return / Purchase Return
                            point back to the original invoice / bill being
                            returned against. SALE skips this field entirely. */}
                        {copy.refLabel && (
                            <>
                                <label className="text-xs text-muted-foreground text-right">{copy.refLabel} <span className="text-destructive">*</span></label>
                                <Input
                                    value={header.refNumber}
                                    onChange={(e) => setHeader((h) => ({ ...h, refNumber: e.target.value }))}
                                    placeholder="—"
                                    className="h-9 text-xs"
                                />
                                <label className="text-xs text-muted-foreground text-right">{copy.refDateLabel} <span className="text-destructive">*</span></label>
                                <Input
                                    type="date"
                                    value={header.refDate}
                                    onChange={(e) => setHeader((h) => ({ ...h, refDate: e.target.value }))}
                                    className="h-9 text-xs"
                                />
                            </>
                        )}

                        {copy.showPaymentTerms && payMode === "CREDIT" && (
                            <>
                                <label className="text-xs text-muted-foreground text-right">Credit Period (days)</label>
                                <Input
                                    type="text"
                                    className="h-9 text-xs w-24"
                                    placeholder="e.g. 30"
                                    value={header.creditPeriodDays}
                                    onChange={(e) => setHeader((h) => ({ ...h, creditPeriodDays: e.target.value.replace(/\D/g, "") }))}
                                />
                            </>
                        )}
                    </div>
                </section>

                {/* ── Item table ───────────────────────────────────────────── */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead className="sticky top-0 z-10 bg-muted border-b border-border text-xs text-muted-foreground">
                            <tr>
                                <th rowSpan={2} className="w-8 px-1 py-2 text-center font-medium align-bottom">
                                    <ScanLine size={13} className="text-muted-foreground/60 mx-auto" />
                                </th>
                                <th rowSpan={2} className="px-2 py-2 text-left font-medium min-w-[180px] align-bottom">ITEM</th>
                                {prefs.mrpHint && (
                                    <th rowSpan={2} className="px-1 py-2 text-right font-medium w-16 align-bottom">MRP</th>
                                )}
                                <th rowSpan={2} className="px-1 py-2 text-right font-medium w-14 align-bottom">QTY</th>
                                {prefs.freeQty && (
                                    <th rowSpan={2} className="px-1 py-2 text-right font-medium w-14 align-bottom" title="Free / complimentary quantity">FREE</th>
                                )}
                                <th rowSpan={2} className="px-1 py-2 text-center font-medium w-10 text-muted-foreground/60 align-bottom">UNIT</th>
                                <th rowSpan={2} className="px-2 py-2 text-right font-medium w-20 align-bottom">
                                    {/* Toggle: price column treats entered rate as excl. or incl. tax */}
                                    <button
                                        type="button"
                                        title={prefs.rateInclTax ? "Prices are entered inclusive of tax — click to switch to exclusive" : "Prices are entered exclusive of tax — click to switch to inclusive"}
                                        onClick={() => toggleRateInclTax()}
                                        className={`text-[10px] leading-tight font-semibold uppercase tracking-wide px-1 py-0.5 rounded transition-colors ${prefs.rateInclTax ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "hover:bg-muted text-muted-foreground"}`}
                                    >
                                        PRICE<br />{prefs.rateInclTax ? "(incl)" : "(excl)"}
                                    </button>
                                </th>
                                {prefs.lineDiscount && (
                                    <th colSpan={2} className="px-1 pt-2 pb-0 text-center font-medium border-l border-border/40">DISCOUNT</th>
                                )}
                                {prefs.lineTax && (
                                    <th colSpan={2} className="px-1 pt-2 pb-0 text-center font-medium border-l border-border/40">TAX</th>
                                )}
                                <th rowSpan={2} className="px-2 py-2 text-right font-medium w-24 align-bottom border-l border-border/40">AMOUNT</th>
                                <th rowSpan={2} className="w-10 px-1 py-2 text-right align-bottom">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" title="Column settings">
                                                <Settings2 size={13} />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-56">
                                            <DropdownMenuLabel className="text-xs">Show columns</DropdownMenuLabel>
                                            <DropdownMenuCheckboxItem checked={prefs.freeQty} onCheckedChange={() => togglePref("freeQty")}>Free Qty</DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem checked={prefs.lineDiscount} onCheckedChange={() => togglePref("lineDiscount")}>Discount</DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem checked={prefs.lineTax} onCheckedChange={() => togglePref("lineTax")}>Tax</DropdownMenuCheckboxItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuLabel className="text-xs">Per-line extras</DropdownMenuLabel>
                                            <DropdownMenuCheckboxItem checked={prefs.mrpHint} onCheckedChange={() => togglePref("mrpHint")}>MRP column</DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem checked={prefs.lineDescription} onCheckedChange={() => togglePref("lineDescription")}>Description (note)</DropdownMenuCheckboxItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuLabel className="text-xs">Price entry</DropdownMenuLabel>
                                            <DropdownMenuCheckboxItem checked={prefs.rateInclTax} onCheckedChange={() => toggleRateInclTax()}>Price includes tax (GST-inclusive)</DropdownMenuCheckboxItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuLabel className="text-xs">Footer fields</DropdownMenuLabel>
                                            <DropdownMenuCheckboxItem checked={prefs.overallDiscount} onCheckedChange={() => togglePref("overallDiscount")}>Overall Discount</DropdownMenuCheckboxItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </th>
                            </tr>
                            {(prefs.lineDiscount || prefs.lineTax) && (
                                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                    {prefs.lineDiscount && (
                                        <>
                                            <th className="px-1 pb-1 text-right font-medium w-12 border-l border-border/40">%</th>
                                            <th className="px-1 pb-1 text-right font-medium w-16">AMT</th>
                                        </>
                                    )}
                                    {prefs.lineTax && (
                                        <>
                                            <th className="px-1 pb-1 text-right font-medium w-12 border-l border-border/40">%</th>
                                            <th className="px-1 pb-1 text-right font-medium w-16">AMT</th>
                                        </>
                                    )}
                                </tr>
                            )}
                        </thead>
                        <tbody>
                            {lines.map((line, i) => {
                                const c = computed[i];
                                const mrp = line.product?.mrp;
                                return (
                                    <Fragment key={line.id}>
                                        <tr className="border-b border-border/50 hover:bg-muted/20 group">
                                            <td className="px-1 py-1 text-muted-foreground text-xs">
                                                {/* Row number + delete button on the LEFT — Vyapar layout.
                                                    Delete only shows on group-hover so the column stays narrow
                                                    when not in use; click is always available though. */}
                                                <div className="flex items-center justify-center gap-0.5">
                                                    <span className="tabular-nums w-4 text-center">{i + 1}</span>
                                                    {lines.length > 1 ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon-xs"
                                                            className="text-destructive/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity h-4 w-4"
                                                            onClick={() => removeLine(line.id)}
                                                            title="Delete row"
                                                        >
                                                            <Trash2 size={10} />
                                                        </Button>
                                                    ) : (
                                                        <span className="w-4" />
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-2 py-1">
                                                <InvProductCombobox
                                                    value={line.product?.id ?? null}
                                                    onChange={(p) => handleProductSelect(line.id, p)}
                                                    autoFocus={i === 0 && !line.product}
                                                />
                                            </td>
                                            {prefs.mrpHint && (
                                                <td className="px-1 py-1 text-right text-xs tabular-nums">
                                                    {/* PURCHASE: editable MRP so the product master stays current.
                                                        Other kinds: read-only hint from the product lookup. */}
                                                    {kind === "PURCHASE" ? (
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.mrpRupees}
                                                            onChange={(e) => updateLine(line.id, { mrpRupees: num(e.target.value) })}
                                                            placeholder="—"
                                                            className={cell}
                                                        />
                                                    ) : (
                                                        <span className="text-muted-foreground">
                                                            {line.mrpRupees || (mrp != null && mrp > 0 ? fmt(mrp) : "")}
                                                        </span>
                                                    )}
                                                </td>
                                            )}
                                            <td className="px-1 py-1">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={line.quantity}
                                                    onChange={(e) => setLineQtyOrRate(line.id, { quantity: num(e.target.value) })}
                                                    className={cell}
                                                />
                                            </td>
                                            {prefs.freeQty && (
                                                <td className="px-1 py-1">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={line.freeQty}
                                                        onChange={(e) => updateLine(line.id, { freeQty: num(e.target.value) })}
                                                        className={cell}
                                                    />
                                                </td>
                                            )}
                                            <td className="px-1 py-1 text-center text-xs text-muted-foreground">
                                                {line.product?.unitCode ?? "—"}
                                            </td>
                                            <td className="px-2 py-1">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={line.rate}
                                                    onChange={(e) => setLineQtyOrRate(line.id, { rate: num(e.target.value) })}
                                                    className={cell}
                                                />
                                            </td>
                                            {prefs.lineDiscount && (
                                                <>
                                                    <td className="px-1 py-1 border-l border-border/40">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.discountPct}
                                                            onChange={(e) => setLineDiscountPct(line.id, num(e.target.value))}
                                                            className={cell}
                                                        />
                                                    </td>
                                                    <td className="px-1 py-1">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.discountAmt}
                                                            onChange={(e) => setLineDiscountAmt(line.id, num(e.target.value))}
                                                            className={cell}
                                                        />
                                                    </td>
                                                </>
                                            )}
                                            {prefs.lineTax && (
                                                <>
                                                    <td className="px-1 py-1 border-l border-border/40">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.taxRate}
                                                            onChange={(e) => setLineTaxRate(line.id, num(e.target.value))}
                                                            className={cell}
                                                        />
                                                    </td>
                                                    <td className="px-1 py-1">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={line.taxAmount}
                                                            onChange={(e) => setLineTaxAmount(line.id, num(e.target.value))}
                                                            className={cell}
                                                        />
                                                    </td>
                                                </>
                                            )}
                                            <td className="px-2 py-1 border-l border-border/40">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={line.amountInput !== "" ? line.amountInput : (c.amount > 0 ? c.amount.toFixed(2) : "")}
                                                    onFocus={(e) => {
                                                        updateLine(line.id, { amountInput: c.amount > 0 ? c.amount.toFixed(2) : "" });
                                                        e.target.select();
                                                    }}
                                                    onChange={(e) => setLineAmount(line.id, num(e.target.value))}
                                                    onBlur={() => updateLine(line.id, { amountInput: "" })}
                                                    className={`${cell} text-right font-mono font-medium`}
                                                />
                                            </td>
                                            <td className="px-1 py-1 text-center">
                                                {/* Right action cell now only holds the note toggle —
                                                    delete moved to the leftmost row-number cell. */}
                                                <div className="flex items-center justify-end gap-1">
                                                    {prefs.lineDescription && (
                                                        <Button
                                                            variant="ghost" size="icon-xs"
                                                            className={`${line.showDescription ? "text-primary" : "text-muted-foreground/60 hover:text-foreground opacity-0 group-hover:opacity-100"} transition-opacity`}
                                                            onClick={() => updateLine(line.id, { showDescription: !line.showDescription })}
                                                            title="Toggle note"
                                                        >
                                                            <StickyNote size={12} />
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                        {prefs.lineDescription && line.showDescription && (
                                            <tr className="border-b border-border/50 bg-muted/10">
                                                <td />
                                                <td colSpan={14} className="px-3 py-1.5">
                                                    <Input
                                                        value={line.description}
                                                        onChange={(e) => updateLine(line.id, { description: e.target.value })}
                                                        placeholder="Note / description for this line (printed on invoice)"
                                                        className="h-7 text-xs"
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                            <tr>
                                <td colSpan={14} className="px-5 py-2 border-b border-border/50">
                                    <Button variant="ghost" size="sm" className="text-primary h-auto py-1 text-xs" onClick={addLine}>
                                        <Plus size={12} className="mr-1" /> Add Row
                                    </Button>
                                </td>
                            </tr>
                            {/* Column totals — read-only summary row matching the reference */}
                            <tr className="bg-muted/40 text-xs font-semibold tabular-nums">
                                <td />
                                <td className="px-2 py-1.5 text-muted-foreground uppercase">Total</td>
                                {prefs.mrpHint && <td />}
                                <td className="px-1 py-1.5 text-right">{totalQty || ""}</td>
                                {prefs.freeQty && <td className="px-1 py-1.5 text-right">{totalFreeQty || ""}</td>}
                                <td />
                                <td />
                                {prefs.lineDiscount && (
                                    <>
                                        <td />
                                        <td className="px-1 py-1.5 text-right font-mono">{totalDisc > 0 ? fmt(totalDisc) : ""}</td>
                                    </>
                                )}
                                {prefs.lineTax && (
                                    <>
                                        <td />
                                        <td className="px-1 py-1.5 text-right font-mono">{totalTax > 0 ? fmt(totalTax) : ""}</td>
                                    </>
                                )}
                                <td className="px-2 py-1.5 text-right font-mono border-l border-border/40">{lineSubtotal > 0 ? fmt(lineSubtotal) : ""}</td>
                                <td />
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* ── Footer: actions + totals ─────────────────────────────── */}
                <div className="relative border-t border-border bg-card">
                    {showProfit && (
                        <div className="absolute inset-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border px-6 py-3 overflow-auto">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-semibold">Estimated Profit (live)</h3>
                                <button type="button" onClick={() => setShowProfit(false)} className="text-xs text-muted-foreground hover:text-foreground">
                                    Close &times;
                                </button>
                            </div>
                            <table className="w-full text-xs">
                                <thead className="text-muted-foreground border-b border-border">
                                    <tr>
                                        <th className="text-left py-1 font-medium">Item</th>
                                        <th className="text-right py-1 font-medium">Qty</th>
                                        <th className="text-right py-1 font-medium">Cost ₹</th>
                                        <th className="text-right py-1 font-medium">Sale (net) ₹</th>
                                        <th className="text-right py-1 font-medium">Profit ₹</th>
                                    </tr>
                                </thead>
                                <tbody className="font-mono tabular-nums">
                                    {lineProfits.map((lp) => (
                                        <tr key={lp.id} className="border-b border-border/50">
                                            <td className="py-1 font-sans">{lp.name}</td>
                                            <td className="text-right py-1">{lp.qty}</td>
                                            <td className="text-right py-1">{fmt(lp.cost * lp.qty)}</td>
                                            <td className="text-right py-1">{fmt(lp.revenue)}</td>
                                            <td className={`text-right py-1 font-semibold ${lp.profit < 0 ? "text-destructive" : ""}`}>
                                                {fmt(lp.profit)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t border-border">
                                        <td colSpan={4} className="py-1 text-right text-muted-foreground">Σ Line Profit</td>
                                        <td className="py-1 text-right font-mono font-semibold">{fmt(totalLineProfit)}</td>
                                    </tr>
                                    {overallDiscount > 0 && (
                                        <tr>
                                            <td colSpan={4} className="py-1 text-right text-muted-foreground">Less: Overall Discount</td>
                                            <td className="py-1 text-right font-mono">−{fmt(overallDiscount)}</td>
                                        </tr>
                                    )}
                                    <tr className="border-t border-border">
                                        <td colSpan={4} className="py-1.5 text-right text-sm font-semibold">Estimated Profit</td>
                                        <td className={`py-1.5 text-right font-mono font-bold text-sm ${estimatedProfit < 0 ? "text-destructive" : "text-green-600"}`}>
                                            ₹ {fmt(estimatedProfit)}
                                            <span className="ml-2 text-[10px] text-muted-foreground">({margin.toFixed(1)}%)</span>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}

                    <div className="grid grid-cols-[1fr_1fr] gap-8 px-6 py-4">
                        {/* Left: voucher-level actions */}
                        <div className="space-y-3 max-w-md">
                            {/* Parent voucher link — GRN→PO, Challan→SO, etc.
                                On pick, the lines auto-copy into the form (user
                                can edit qty for partial fulfilment). */}
                            {copy.linkParentType && (
                                <ParentVoucherPicker
                                    parentType={copy.linkParentType}
                                    pickedRef={parentLink?.reference ?? null}
                                    onClear={() => setParentLink(null)}
                                    label={copy.linkParentLabel ?? "Link to parent"}
                                    onPick={(parent) => {
                                        setParentLink({ id: parent.id, reference: parent.reference });
                                        // Carry over the parent's party so the user doesn't re-pick.
                                        if (parent.partyId != null && parent.partyType) {
                                            setParty({
                                                id: parent.partyId,
                                                kind: (parent.partyType === "customer" || parent.partyType === "supplier" || parent.partyType === "company")
                                                    ? parent.partyType
                                                    : (copy.party === "Sundry Debtors" ? "customer" : "supplier"),
                                                name: parent.partyName ?? "",
                                                phone: parent.partyPhone ?? null,
                                            } as PickedParty);
                                        }
                                        // Save the parent's reference + date for downstream printing /
                                        // tracking — the form already reuses these for supplier-bill.
                                        setHeader((h) => ({
                                            ...h,
                                            refNumber: parent.reference,
                                            refDate:   parent.date ? parent.date.slice(0, 10) : h.refDate,
                                        }));
                                        // Verbatim line copy — user can edit qty for partial fulfilment.
                                        setLines(parent.lines.length === 0 ? [newLine()] : parent.lines.map((l) => ({
                                            id: ++lineSeq,
                                            product: {
                                                id: l.product.id,
                                                sku: l.product.sku,
                                                name: l.product.name,
                                                unitCode: l.product.unit.code,
                                                stock: null,
                                                salePrice: null,
                                                costPrice: null,
                                                mrp: null,
                                            },
                                            quantity:    String(Number(l.quantity) || 0),
                                            freeQty:     l.freeQty != null && Number(l.freeQty) > 0 ? String(Number(l.freeQty)) : "",
                                            rate:        String(Number(l.rate) || 0),
                                            mrpRupees:   "",
                                            discountPct: Number(l.discountPct) > 0 ? String(Number(l.discountPct)) : "",
                                            discountAmt: Number(l.discountAmt) > 0 ? String(Number(l.discountAmt)) : "",
                                            taxRate:     Number(l.taxRate)     > 0 ? String(Number(l.taxRate))     : "",
                                            taxAmount:   Number(l.taxAmount)   > 0 ? String(Number(l.taxAmount))   : "",
                                            amountInput: "",
                                            description: l.description ?? "",
                                            showDescription: !!l.description,
                                        })));
                                    }}
                                />
                            )}

                            {/* Challan-only: persist printable price visibility on the voucher. */}
                            {copy.showShowPricesToggle && (
                                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                                    <div>
                                        <p className="font-medium text-foreground">Show prices on printed challan</p>
                                        <p className="text-muted-foreground">Off → print shows quantities only. Useful for confidential B2B delivery.</p>
                                    </div>
                                    <Switch
                                        checked={showPricesOnPrint}
                                        onCheckedChange={(v) => setShowPricesOnPrint(v)}
                                    />
                                </div>
                            )}

                            {/* Cash / Bank ledger picker — Vyapar's "Payment Type"
                                slot. Always visible in CASH mode; in CREDIT mode,
                                only when the user has typed a Received amount > 0
                                (the upfront cash has to land somewhere). */}
                            {copy.showPaymentBlock && (payMode === "CASH" || received > 0) && cashBankAccounts.length > 0 && (
                                <div className="space-y-1">
                                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                        {copy.cashLedgerLabel}
                                    </label>
                                    <GlAccountCombobox
                                        value={paymentAccount?.id ?? null}
                                        onChange={setPaymentAccount}
                                        accounts={cashBankAccounts}
                                        placeholder="Cash in Hand"
                                        className="w-56"
                                    />
                                </div>
                            )}
                            <div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowDescription((s) => !s)}
                                    className="gap-1.5"
                                >
                                    <StickyNote size={13} />
                                    {showDescription ? "Hide" : "Add"} Description
                                </Button>
                                {showDescription && (
                                    <Input
                                        value={header.description}
                                        onChange={(e) => setHeader((h) => ({ ...h, description: e.target.value }))}
                                        placeholder={party ? `Narration (default: ${copy.narrationFallback(party.name)})` : "Narration (optional — invoice no auto-generated)"}
                                        className="mt-2 h-9"
                                    />
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled
                                    title="Attachments coming soon"
                                    className="gap-1.5 text-muted-foreground"
                                >
                                    <ImageIcon size={13} /> Add Image
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled
                                    title="Attachments coming soon"
                                    className="gap-1.5 text-muted-foreground"
                                >
                                    <FileText size={13} /> Add Document
                                </Button>
                            </div>
                        </div>

                        {/* Right: totals + payment */}
                        <div className="space-y-2 max-w-md ml-auto w-full">
                            {/* Subtotal — sum of line amounts before voucher-level adjustments. */}
                            <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm">
                                <span className="text-muted-foreground text-right">Subtotal</span>
                                <span className="w-20" />
                                <span className="w-28 text-right font-mono tabular-nums text-sm">{fmt(lineSubtotal)}</span>
                            </div>
                            {prefs.overallDiscount && (
                                <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm">
                                    <span className="text-muted-foreground text-right">Discount</span>
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={header.discountPct}
                                        onChange={(e) => handleDiscountPctChange(num(e.target.value))}
                                        className="h-8 w-20 text-xs text-right"
                                        placeholder="%"
                                    />
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={header.discountAmt}
                                        onChange={(e) => handleDiscountAmtChange(num(e.target.value))}
                                        className="h-8 w-28 text-xs text-right"
                                        placeholder="₹"
                                    />
                                </div>
                            )}
                            <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm">
                                <span className="text-muted-foreground text-right">Shipping</span>
                                <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={header.shippingAmt}
                                    onChange={(e) => setHeader((h) => ({ ...h, shippingAmt: num(e.target.value) }))}
                                    className="h-8 w-20 text-xs text-right"
                                    placeholder="0"
                                />
                                <span className="w-28 text-right font-mono tabular-nums text-sm">{fmt(shipping)}</span>
                            </div>
                            {/* Total + inline Round Off — Vyapar-style merged row.
                                Checkbox + ₹ input sit to the LEFT of the bold Total
                                label, saving one row of vertical space vs a separate
                                Round Off line. The auto-compute / manual-override
                                logic is unchanged — only the layout was flattened. */}
                            <div className="grid grid-cols-[auto_auto_1fr_auto] gap-3 items-center text-base font-bold border-t border-border pt-2">
                                <label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground cursor-pointer">
                                    <Checkbox
                                        checked={enableRoundOff}
                                        onCheckedChange={(v) => {
                                            const next = v === true;
                                            setEnableRoundOff(next);
                                            // Re-arm auto-compute on toggle: untick clears the value,
                                            // re-tick re-derives from the current pre-round total.
                                            setRoundOffManuallyEdited(false);
                                            if (!next) setHeader((h) => ({ ...h, roundOff: "" }));
                                        }}
                                    />
                                    Round Off
                                </label>
                                {enableRoundOff ? (
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={header.roundOff}
                                        onChange={(e) => {
                                            // Once the user types here, stop auto-recomputing.
                                            setRoundOffManuallyEdited(true);
                                            setHeader((h) => ({ ...h, roundOff: numSigned(e.target.value) }));
                                        }}
                                        className="h-7 w-20 text-xs text-right font-normal"
                                        placeholder="0"
                                        title="Auto-computed; edit to override"
                                    />
                                ) : (
                                    <span />
                                )}
                                <span className="text-right">Total</span>
                                <span className="w-28 text-right font-mono tabular-nums">₹ {fmt(grandTotal)}</span>
                            </div>
                            {copy.showPaymentBlock && (
                                <>
                                    <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm pt-2 border-t border-border">
                                        <span className="text-muted-foreground text-right">{copy.receivedLabel ?? "Received"}</span>
                                        <Input
                                            type="text"
                                            inputMode="decimal"
                                            value={header.received}
                                            onChange={(e) => setHeader((h) => ({ ...h, received: num(e.target.value) }))}
                                            className="h-8 w-20 text-xs text-right"
                                            placeholder="0"
                                        />
                                        <span className="w-28 text-right font-mono tabular-nums">{fmt(received)}</span>
                                    </div>
                                    <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm font-semibold">
                                        <span className="text-right">Balance</span>
                                        <span className="w-20" />
                                        <span className={`w-28 text-right font-mono tabular-nums ${balance > 0 ? "text-destructive" : "text-green-600"}`}>
                                            ₹ {fmt(balance)}
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

            </ScrollArea>

            {/* ── Sticky action bar ────────────────────────────────────── */}
            <div className="border-t border-border bg-card px-6 py-3 flex items-center gap-2 shrink-0">
                {/* Bill-wise details / link-payment — placeholder for the Tally-style
                    "settle this bill against open receipts" flow. Real allocation
                    UI lands in a follow-up; the button confirms the location. */}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toast.info("Bill-wise details — coming soon. Will let you allocate this sale against the customer's open advance receipts.")}
                    className="gap-1.5 text-muted-foreground hover:text-foreground"
                    title="Link this sale to existing bills / advance receipts"
                >
                    <Link2 size={14} /> Link Payment
                </Button>
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" onClick={() => router.push(copy.listPath)}>
                        Cancel
                    </Button>
                    {copy.showProfit && (
                        <Button variant="outline" onClick={() => setShowProfit((s) => !s)} title="Show estimated profit (live)">
                            {showProfit ? "Hide" : "Show"} Profit
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
                        {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save Draft
                    </Button>
                    {copy.showPrint && (
                        <Button variant="outline" onClick={() => submit(true, true)} disabled={saving}>
                            {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save &amp; Print
                        </Button>
                    )}
                    <Button onClick={() => submit(true)} disabled={saving}>
                        {saving && <Loader2 size={13} className="animate-spin mr-1" />} Save
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function SaleVoucherPage(props: { kind?: TradingKind }) {
    return (
        <Suspense fallback={<div>Loading…</div>}>
            <SaleVoucherPageInner {...props} />
        </Suspense>
    );
}
