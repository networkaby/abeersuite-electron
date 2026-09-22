/**
 * Single source of truth for VoucherPrintTemplate kinds and their defaults.
 * "Print templates" is the customer-facing name; the model + `kind` PK are a
 * generic per-document print registry — accountancy vouchers AND the repair-shop
 * documents (repair ticket, shipping slip) all live here.
 *
 * Used by:
 *   • prisma/seeds/bootstrap-seed.ts        — initial upsert of every kind in VOUCHER_TEMPLATE_KINDS
 *   • /api/settings/voucher-templates/...   — list-auto-upsert, reset-to-default
 *   • /office/settings/voucher-templates    — UI grouping (Accounting / Inventory / Repair)
 *   • src/shared/lib/print/voucherTemplate.ts — runtime fallback if a row is missing
 *
 * The accounting/inventory kinds mirror the VoucherType + InvVoucherType enums in
 * prisma/schema/enums.prisma; the repair kinds are plain string ids with no enum.
 * If you add a kind, add it here too (the bootstrap seed re-runs upserts so a new
 * kind is a one-line change followed by a re-seed).
 */

export const ACCOUNTING_VOUCHER_KINDS = [
    // CONTRA is the PLAIN contra print (bank ↔ cash withdrawal, uncounted cash
    // moves) — a neutral journal. Its two richer outputs are print-only variants
    // below, each on its own customizable template. All three are the SAME
    // voucher TYPE in the DB (CONTRA); buildGlSample() picks the print kind.
    "CONTRA",
    // Cash → Bank pay-in slip (bank block, PAN, depositor counterfoil).
    "BANK_DEPOSIT",
    // Cash → Cash handover between the shop's own cash points (till → vault,
    // counter → head office) — from/to ledgers + handed-by/received-by sigs.
    "CASH_HANDOVER",
    "PAYMENT",
    "RECEIPT",
    "CREDIT_NOTE",
    "DEBIT_NOTE",
    "JOURNAL",
] as const;

export const INVENTORY_VOUCHER_KINDS = [
    "PURCHASE",
    "SALE",
    "POS",
    // Online-channel invoice (shop order → one-click ONLINE_INVOICE). Seeded as
    // a DUPLICATE of the POS receipt (same ladder look) but its own row — the
    // parcel-insert print can diverge from the counter slip independently.
    "ONLINE_INVOICE",
    "ESTIMATE",
    "POS_ESTIMATE",
    "POS_ORDER",
    "SALE_RETURN",
    "PURCHASE_RETURN",
    "MANUFACTURING_JOURNAL",
    "PHYSICAL_STOCK",
    "BRANCH_TRANSFER",
    "GRN",
    "CHALLAN",
    "REJECTION_IN",
    "REJECTION_OUT",
    "SALES_ORDER",
    "PURCHASE_ORDER",
] as const;

// Non-voucher prints that share the same per-kind print-template registry —
// the repair-shop documents. They are NOT accountancy vouchers; they carry a
// device / service body instead of a ledger table, but they reuse the same
// header / address / GSTIN / logo / footer / signature chrome so the shop's
// branding is configured in ONE place. See /receipt/[id] (repair ticket) and
// /shipping-slip/[ticketId].
export const REPAIR_DOCUMENT_KINDS = [
    "REPAIR_TICKET",
    "SHIPPING_SLIP",
    // Packet address label for a device sent to a service centre (To = centre,
    // From = shop letterhead). Named for "service" so the delivery label
    // (product parcel) sits beside it.
    "SERVICE_SHIPPING_LABEL",
    // Parcel label for a shop-order shipped by OUR couriers (local delivery /
    // Standard courier) — courier-standard face: To + pincode big, COD banner,
    // AWB barcode, From small. Aggregator shipments (Shiprocket/Shipway) print
    // the carrier's own PDF instead, never this. See /shipping-label/order/[id].
    "DELIVERY_SHIPPING_LABEL",
] as const;

// Marketing cards — the printable coupon and gift card. Not vouchers: a QR +
// code card with its own face (CouponCard / GiftCardCard), but the brand line,
// small label, terms and foot come from the same per-kind template registry.
export const MARKETING_DOCUMENT_KINDS = [
    "COUPON",
    "GIFT_CARD",
] as const;

// POS Register documents — end-of-shift cash reconciliation & till summary.
export const POS_DOCUMENT_KINDS = [
    "SHIFT_CLOSE",
] as const;

// HR & People documents. The salary slip is a person's own frozen payroll line
// (PayrollRunLine) with the letterhead chrome around it — no ledger table, no
// tax. See /receipt/payslip/[lineId]. The staff ID card is deliberately NOT
// here (owner, 2026-09-20: its preview is its template).
export const HR_DOCUMENT_KINDS = [
    "PAYSLIP",
] as const;

export const VOUCHER_TEMPLATE_KINDS = [
    ...ACCOUNTING_VOUCHER_KINDS,
    ...INVENTORY_VOUCHER_KINDS,
    ...REPAIR_DOCUMENT_KINDS,
    ...MARKETING_DOCUMENT_KINDS,
    ...POS_DOCUMENT_KINDS,
    ...HR_DOCUMENT_KINDS,
] as const;

export type VoucherTemplateKind = (typeof VOUCHER_TEMPLATE_KINDS)[number];

export const VOUCHER_TEMPLATE_KIND_GROUPS = {
    accounting: ACCOUNTING_VOUCHER_KINDS,
    inventory: INVENTORY_VOUCHER_KINDS,
    pos: POS_DOCUMENT_KINDS,
    repair: REPAIR_DOCUMENT_KINDS,
    marketing: MARKETING_DOCUMENT_KINDS,
    hr: HR_DOCUMENT_KINDS,
} as const;

// Human-readable per-kind sub-titles that go into headerLine2 by default.
// Kept verbose for clarity on a thermal slip — admin can shorten via the UI.
const HEADER_LINE_2: Record<VoucherTemplateKind, string> = {
    CONTRA: "Contra Voucher",
    BANK_DEPOSIT: "Bank Deposit Slip",
    CASH_HANDOVER: "Cash Handover Slip",
    PAYMENT: "Payment Voucher",
    RECEIPT: "Receipt Voucher",
    CREDIT_NOTE: "Credit Note",
    DEBIT_NOTE: "Debit Note",
    JOURNAL: "Journal Voucher",

    PURCHASE: "Purchase Invoice",
    SALE: "Tax Invoice",
    POS: "POS sale receipt",
    ONLINE_INVOICE: "Tax Invoice (Online Order)",
    ESTIMATE: "Estimate / Quotation",
    POS_ESTIMATE: "Estimate / Quotation",
    POS_ORDER: "Order Confirmation",
    SALE_RETURN: "Sale Return",
    PURCHASE_RETURN: "Purchase Return",
    MANUFACTURING_JOURNAL: "Manufacturing Journal",
    PHYSICAL_STOCK: "Physical Stock Voucher",
    BRANCH_TRANSFER: "Branch Transfer",
    GRN: "Goods Receipt Note",
    CHALLAN: "Delivery Challan",
    REJECTION_IN: "Rejection In",
    REJECTION_OUT: "Rejection Out",
    SALES_ORDER: "Sales Order",
    PURCHASE_ORDER: "Purchase Order",

    REPAIR_TICKET: "Job Receipt / Service Ticket",
    SHIPPING_SLIP: "Service Slip / Delivery Challan",
    SERVICE_SHIPPING_LABEL: "Service Shipping Label",
    DELIVERY_SHIPPING_LABEL: "Parcel Shipping Label",
    COUPON: "Coupon",
    GIFT_CARD: "Gift Card",
    SHIFT_CLOSE: "Shift Closing & Cash Reconciliation",
    PAYSLIP: "Salary Slip",
};

// Voucher kinds that don't have a monetary tax breakdown by their nature.
// We start them with showTaxSummary=false so the seeded preview matches reality.
const NO_TAX_SUMMARY: ReadonlySet<VoucherTemplateKind> = new Set<VoucherTemplateKind>([
    "CONTRA",
    "BANK_DEPOSIT",
    "CASH_HANDOVER",
    "JOURNAL",
    "MANUFACTURING_JOURNAL",
    "PHYSICAL_STOCK",
    "BRANCH_TRANSFER",
    "REJECTION_IN",
    "REJECTION_OUT",
    // Repair-shop documents carry no ledger / tax table.
    "REPAIR_TICKET",
    "SHIPPING_SLIP",
    "SERVICE_SHIPPING_LABEL",
    "DELIVERY_SHIPPING_LABEL",
    "COUPON",
    "GIFT_CARD",
    "SHIFT_CLOSE",
    "PAYSLIP",
]);

// Repair-shop documents that show customer + staff signature lines by default.
const WITH_SIGNATURE: ReadonlySet<VoucherTemplateKind> = new Set<VoucherTemplateKind>([
    "REPAIR_TICKET",
    // Cash paid out needs proof it reached the payee — the receiver signs.
    "PAYMENT",
    "SHIFT_CLOSE",
    // A slip handed to a person is signed for the shop.
    "PAYSLIP",
]);

// Kinds that print a scannable barcode of the voucher number by default — the
// invoices a customer keeps and may bring back, so a return clerk can scan the
// slip to pull up the original sale. Applies to both A4 + thermal seeds; the
// two flags can then be tuned independently per format.
const BARCODE_KINDS: ReadonlySet<VoucherTemplateKind> = new Set<VoucherTemplateKind>([
    "SALE",
    "POS",
    "ONLINE_INVOICE",
    "SALE_RETURN",
]);

// Money slips (RECEIPT / PAYMENT) show the party's running balance
// (before / after) by default — it is the customer's own account on a slip
// handed to them. Every other kind keeps it off: a goods invoice may be seen
// by anyone. Both A4 + thermal seeds; tunable per format afterwards.
const PARTY_BALANCE_KINDS: ReadonlySet<VoucherTemplateKind> = new Set<VoucherTemplateKind>([
    "RECEIPT",
    "PAYMENT",
]);

// Per-kind default footer / terms overrides (blank kinds fall back to the
// generic footer and empty terms). The repair ticket seeds the shop's standard
// service terms so they render out-of-the-box AND stay editable on the
// print-templates settings page.
const FOOTER_LINE_BY_KIND: Partial<Record<VoucherTemplateKind, string>> = {
    REPAIR_TICKET: "Thank you for your trust!",
    SHIPPING_SLIP: "Please return the device with this slip.",
    SERVICE_SHIPPING_LABEL: "Handle with care · Fragile electronics",
    DELIVERY_SHIPPING_LABEL: "Handle with care",
};

const DEFAULT_DISCLAIMER_LINE = "This is a computer-generated document and does not require a signature.";

// Per-kind signature-label overrides. On the service slip the label IS the
// shop's signature line ("Sent by (Shop)"); on a payment voucher it's the
// PAYEE acknowledging cash received — proof of payment, not the shop's own
// sign-off — so it must not default to "Authorised Signatory". Other kinds
// use that generic label.
const SIGNATURE_LABEL_BY_KIND: Partial<Record<VoucherTemplateKind, string>> = {
    SHIPPING_SLIP: "Sent by (Shop)",
    PAYMENT: "Receiver's Signature",
    SHIFT_CLOSE: "Cashier Signature",
};

const TERMS_TEXT_BY_KIND: Partial<Record<VoucherTemplateKind, string>> = {
    REPAIR_TICKET: [
        "1. Please keep this receipt. It is required for device collection.",
        "2. Estimated cost may vary after diagnosis.",
        "3. Uncollected devices after 30 days may incur storage charges.",
        "4. We are not responsible for data loss during repair.",
        "5. Warranty void if device is tampered with externally.",
    ].join("\n"),
};

// Paper formats. Keep the strings stable — they're persisted in the DB and
// read by the print route's `?paper=` override.
export const PAPER_FORMATS = ["A4", "THERMAL_80MM"] as const;
export type PaperFormat = (typeof PAPER_FORMATS)[number];

export function isPaperFormat(value: string): value is PaperFormat {
    return (PAPER_FORMATS as readonly string[]).includes(value);
}

// Per-kind default paper. POS prints on the counter thermal printer; every
// other kind defaults to a formal A4 invoice. Admin can flip either via the
// settings page.
const DEFAULT_PAPER_BY_KIND: Record<VoucherTemplateKind, PaperFormat> = {
    CONTRA: "A4",
    BANK_DEPOSIT: "A4",
    CASH_HANDOVER: "A4",
    PAYMENT: "A4",
    RECEIPT: "A4",
    CREDIT_NOTE: "A4",
    DEBIT_NOTE: "A4",
    JOURNAL: "A4",
    PURCHASE: "A4",
    SALE: "A4",
    POS: "THERMAL_80MM",
    // Duplicate of POS, but the primary use is the parcel-insert print — an A4
    // sheet packs better with the item; flip per taste on the settings page.
    ONLINE_INVOICE: "A4",
    ESTIMATE: "A4",
    POS_ESTIMATE: "THERMAL_80MM",
    POS_ORDER: "THERMAL_80MM",
    SALE_RETURN: "A4",
    PURCHASE_RETURN: "A4",
    MANUFACTURING_JOURNAL: "A4",
    PHYSICAL_STOCK: "A4",
    BRANCH_TRANSFER: "A4",
    GRN: "A4",
    CHALLAN: "A4",
    REJECTION_IN: "A4",
    REJECTION_OUT: "A4",
    SALES_ORDER: "A4",
    PURCHASE_ORDER: "A4",
    // Repair ticket prints on the counter thermal roll like a job slip; the
    // shipping slip is a formal A5/A4 hand-off document.
    REPAIR_TICKET: "THERMAL_80MM",
    SHIPPING_SLIP: "A4",
    SERVICE_SHIPPING_LABEL: "A4",
    // The parcel label's real sizes (4×6 roll / A4 2-up / 80mm strip) live on its
    // own print page; this default only satisfies the shared registry.
    DELIVERY_SHIPPING_LABEL: "A4",
    // Cards print as a fixed 360px face in the browser; A4 only satisfies the registry.
    COUPON: "A4",
    GIFT_CARD: "A4",
    SHIFT_CLOSE: "THERMAL_80MM",
    PAYSLIP: "A4",
};

// Per-kind default for the voucher form's "Print after save" toggle
// (true = print by default, false = off). This is the SINGLE place to set each
// voucher's print default — every voucher form seeds its toggle from here via
// printAfterSaveDefault(). The user can still flip the toggle per voucher on the
// form. POS / online channels manage their own printing and ignore this map.
export const PRINT_AFTER_SAVE_DEFAULT_BY_KIND: Record<VoucherTemplateKind, boolean> = {
    CONTRA: false,
    BANK_DEPOSIT: false,
    CASH_HANDOVER: false,
    PAYMENT: false,
    RECEIPT: true,
    CREDIT_NOTE: false,
    DEBIT_NOTE: false,
    JOURNAL: false,
    PURCHASE: false,
    SALE: true,
    POS: true,
    ONLINE_INVOICE: true,
    ESTIMATE: true,
    POS_ESTIMATE: true,
    POS_ORDER: true,
    // POS_RETURN: true,  // TODO: add this
    //POS_Receipt: true,  // TODO: add this
    SALE_RETURN: true,
    PURCHASE_RETURN: false,
    MANUFACTURING_JOURNAL: false,
    PHYSICAL_STOCK: false,
    BRANCH_TRANSFER: false,
    GRN: false,
    CHALLAN: false,
    REJECTION_IN: false,
    REJECTION_OUT: false,
    SALES_ORDER: false,
    PURCHASE_ORDER: false,
    // Repair documents print from their own screens, not a voucher form — these
    // toggles are unused for them, kept only to satisfy the exhaustive record.
    REPAIR_TICKET: false,
    SHIPPING_SLIP: false,
    SERVICE_SHIPPING_LABEL: false,
    DELIVERY_SHIPPING_LABEL: false,
    COUPON:                false,
    GIFT_CARD:             false,
    SHIFT_CLOSE:           true,
    PAYSLIP:               false,
};

/** Initial "Print after save" toggle state for a voucher kind (false if unknown). */
export function printAfterSaveDefault(kind: string): boolean {
    return isVoucherTemplateKind(kind) ? PRINT_AFTER_SAVE_DEFAULT_BY_KIND[kind] : false;
}

// Per-kind default for the voucher form's "Thermal" toggle (true = auto-fire to
// the thermal printer like POS, with browser fallback; false = traditional
// browser print page where the customer's paper size — set per kind on the
// voucher-templates page — applies). SINGLE place to set each voucher's mode;
// the user can still flip it per voucher on the form. POS / online ignore this.
export const THERMAL_DEFAULT_BY_KIND: Record<VoucherTemplateKind, boolean> = {
    CONTRA:                false,
    BANK_DEPOSIT:          false,
    CASH_HANDOVER:         false,
    PAYMENT:               true,
    RECEIPT:               true,
    CREDIT_NOTE:           false,
    DEBIT_NOTE:            false,
    JOURNAL:               false,
    PURCHASE:              false,
    SALE:                  false,
    POS:                   true,
    // Parcel insert prints from the office on A4 — browser print, not the
    // counter thermal auto-fire.
    ONLINE_INVOICE:        false,
    ESTIMATE:              false,
    POS_ESTIMATE:          true,
    POS_ORDER:             true,
    SALE_RETURN:           false,
    PURCHASE_RETURN:       false,
    MANUFACTURING_JOURNAL: false,
    PHYSICAL_STOCK:        false,
    BRANCH_TRANSFER:       false,
    GRN:                   false,
    CHALLAN:               false,
    REJECTION_IN:          false,
    REJECTION_OUT:         false,
    SALES_ORDER:           false,
    PURCHASE_ORDER:        false,
    // Unused for repair documents (they print from their own screens).
    REPAIR_TICKET:         false,
    SHIPPING_SLIP:         false,
    SERVICE_SHIPPING_LABEL: false,
    DELIVERY_SHIPPING_LABEL: false,
    COUPON:                false,
    GIFT_CARD:             false,
    SHIFT_CLOSE:           true,
    PAYSLIP:               false,
};

/** Initial "Thermal" toggle state for a voucher kind (false → browser print). */
export function thermalDefault(kind: string): boolean {
    return isVoucherTemplateKind(kind) ? THERMAL_DEFAULT_BY_KIND[kind] : false;
}

export interface VoucherTemplateDefaults {
    kind: VoucherTemplateKind;
    headerLine1: string;
    headerLine2: string;
    addressBlock: string;
    gstinLine: string;
    phoneLine: string;
    // Shop email + website + bank block — DERIVED ONLY: filled from the
    // Organisation (contact / bank) at merge time, never persisted. Optional +
    // absent from the builder/mapper so they never reach a Prisma write (they
    // are not DB columns).
    emailLine?: string;
    websiteLine?: string;
    bankDetails?: string; // labelled multi-line block; blank hides the section
    bankUpiQr?: string;   // upi://pay deep link for the scan-to-pay QR; blank hides it
    logoUrl: string;
    // Every element has an A4 flag (base name) + a `…Thermal` flag. The base
    // names are the A4 values; resolveTemplateForFormat() swaps in the thermal
    // values for the 80mm slip so the renderers can stay format-agnostic.
    showLogo: boolean;               showLogoThermal: boolean;
    showHeaderText: boolean;         showHeaderTextThermal: boolean;   // brand-name line
    showAddress: boolean;            showAddressThermal: boolean;      // Head-Office address
    showBranchAddress: boolean;      showBranchAddressThermal: boolean;// issuing-branch address
    showGstin: boolean;              showGstinThermal: boolean;
    showPhone: boolean;              showPhoneThermal: boolean;
    showTaxSummary: boolean;         showTaxSummaryThermal: boolean;
    showMrp: boolean;                showMrpThermal: boolean;
    showSignature: boolean;          showSignatureThermal: boolean;
    showBarcode: boolean;            showBarcodeThermal: boolean;
    showBank: boolean;               showBankThermal: boolean;   // shop bank details block
    // Party's running ledger balance (Previous / Closing) beside the bill's own
    // balance-due. Off by default — it discloses the customer's whole account.
    showPartyBalance: boolean;       showPartyBalanceThermal: boolean;
    showQrCode: boolean; // dormant (not yet rendered)
    // Service Shipping Label meta fields (bottom strip). Base flag = A4/A5/A6
    // sheets; Thermal = 80mm roll; Tl = Thermal Label 100×50 (die-cut). Ignored
    // by every other kind.
    showTicket: boolean;             showTicketThermal: boolean;             showTicketTl: boolean;
    showDate: boolean;               showDateThermal: boolean;               showDateTl: boolean;
    showRef: boolean;                showRefThermal: boolean;                showRefTl: boolean;
    showDevice: boolean;             showDeviceThermal: boolean;             showDeviceTl: boolean;   // OFF by default — theft risk
    showFooter: boolean;             showFooterThermal: boolean;             showFooterTl: boolean;
    // Service Slip sign-off rows — each independently toggleable, per format
    // (A4 base + Thermal). Ignored by every other kind. On by default.
    showSentBy: boolean;             showSentByThermal: boolean;
    showReceivedBy: boolean;         showReceivedByThermal: boolean;
    showPreparedBy: boolean;         showPreparedByThermal: boolean;
    showFindings: boolean;           showFindingsThermal: boolean;   // findings box + return note
    termsText: string;
    footerLine: string;
    signatureLabel: string;
    disclaimerLine: string; // e.g. "computer-generated, no signature required" — blank hides it
    defaultPaper: PaperFormat;
    paperWidthMm: number;
    fontFamily: string;
    fontSizePx: number;
}

/**
 * Returns the canonical default row for a kind. Reused by both seed and the
 * reset-to-default endpoint so the two stay in sync by construction.
 *
 * `headerLine1` is intentionally left blank — mergeTemplateWithOrg() fills it
 * from the Organisation brand at print time, so the brand is never baked into
 * the DB and a rename in Organisation settings reaches every document.
 */
export function buildVoucherTemplateDefaults(kind: VoucherTemplateKind): VoucherTemplateDefaults {
    return {
        kind,
        headerLine1: "",
        headerLine2: HEADER_LINE_2[kind],
        addressBlock: "",
        gstinLine: "",
        phoneLine: "",
        logoUrl: "",
        // A4 (base) + thermal mirror of each default.
        showLogo: false,                                 showLogoThermal: false,
        showHeaderText: true,                            showHeaderTextThermal: true,
        showAddress: true,                               showAddressThermal: true,
        showBranchAddress: false,                        showBranchAddressThermal: false,
        showGstin: true,                                 showGstinThermal: true,
        showPhone: true,                                 showPhoneThermal: true,
        showTaxSummary: !NO_TAX_SUMMARY.has(kind),       showTaxSummaryThermal: !NO_TAX_SUMMARY.has(kind),
        showMrp: true,                                   showMrpThermal: true,
        showSignature: WITH_SIGNATURE.has(kind),         showSignatureThermal: WITH_SIGNATURE.has(kind),
        showBarcode: BARCODE_KINDS.has(kind),            showBarcodeThermal: BARCODE_KINDS.has(kind),
        showBank: false,                                 showBankThermal: false,
        showPartyBalance: PARTY_BALANCE_KINDS.has(kind), showPartyBalanceThermal: PARTY_BALANCE_KINDS.has(kind),
        showQrCode: false,
        // Label meta — device hidden by default (theft), the rest shown.
        showTicket: true,                                showTicketThermal: true,          showTicketTl: true,
        showDate: true,                                  showDateThermal: true,            showDateTl: true,
        showRef: true,                                   showRefThermal: true,             showRefTl: true,
        showDevice: false,                               showDeviceThermal: false,         showDeviceTl: false,
        showFooter: true,                                showFooterThermal: true,          showFooterTl: true,
        // Slip sign-off rows — all shown by default (A4 + thermal mirror).
        showSentBy: true,                                showSentByThermal: true,
        showReceivedBy: true,                            showReceivedByThermal: true,
        showPreparedBy: true,                            showPreparedByThermal: true,
        showFindings: true,                              showFindingsThermal: true,
        termsText: TERMS_TEXT_BY_KIND[kind] ?? "",
        footerLine: FOOTER_LINE_BY_KIND[kind] ?? "Thank you · Visit again",
        signatureLabel: SIGNATURE_LABEL_BY_KIND[kind] ?? "Authorised Signatory",
        disclaimerLine: DEFAULT_DISCLAIMER_LINE,
        defaultPaper: DEFAULT_PAPER_BY_KIND[kind],
        paperWidthMm: 80,
        fontFamily: "Courier New, monospace",
        fontSizePx: 12,
    };
}

export function isVoucherTemplateKind(value: string): value is VoucherTemplateKind {
    return (VOUCHER_TEMPLATE_KINDS as readonly string[]).includes(value);
}

// Vouchers whose party is a SUPPLIER (vendor) rather than a customer — the
// print's party box is labelled "Supplier" instead of "Bill To" / "Customer".
const SUPPLIER_PARTY_KINDS: ReadonlySet<VoucherTemplateKind> = new Set<VoucherTemplateKind>([
    "PURCHASE",
    "PURCHASE_RETURN",
    "PURCHASE_ORDER",
    "GRN",
    "REJECTION_OUT",
    // A debit note is raised AGAINST a supplier (purchase-side claim); a credit
    // note is issued TO a customer (sales-side), so only DEBIT_NOTE is here.
    "DEBIT_NOTE",
]);

/** True when the voucher's party is a supplier (purchase-side document). */
export function isSupplierPartyKind(kind: string): boolean {
    return isVoucherTemplateKind(kind) && SUPPLIER_PARTY_KINDS.has(kind);
}

/**
 * Structural shape of a `VoucherPrintTemplate` DB row. Booleans are optional /
 * nullable so the mapper below tolerates the window before `prisma db push`
 * adds a newly-introduced column (the value reads back as `undefined`).
 */
export type VoucherPrintTemplateRow = {
    kind: string;
    headerLine1: string; headerLine2: string; addressBlock: string;
    gstinLine: string; phoneLine: string; logoUrl: string;
    showLogo?: boolean | null;                showLogoThermal?: boolean | null;
    showHeaderText?: boolean | null;          showHeaderTextThermal?: boolean | null;
    showAddress?: boolean | null;             showAddressThermal?: boolean | null;
    showBranchAddress?: boolean | null;       showBranchAddressThermal?: boolean | null;
    showGstin?: boolean | null;               showGstinThermal?: boolean | null;
    showPhone?: boolean | null;               showPhoneThermal?: boolean | null;
    showTaxSummary?: boolean | null;          showTaxSummaryThermal?: boolean | null;
    showMrp?: boolean | null;                 showMrpThermal?: boolean | null;
    showSignature?: boolean | null;           showSignatureThermal?: boolean | null;
    showQrCode?: boolean | null;
    showBarcode?: boolean | null;             showBarcodeThermal?: boolean | null;
    showBank?: boolean | null;                showBankThermal?: boolean | null;
    showPartyBalance?: boolean | null;        showPartyBalanceThermal?: boolean | null;
    // Label meta fields — optional so reads tolerate the pre-`db push` window.
    showTicket?: boolean | null;              showTicketThermal?: boolean | null;              showTicketTl?: boolean | null;
    showDate?: boolean | null;                showDateThermal?: boolean | null;                showDateTl?: boolean | null;
    showRef?: boolean | null;                 showRefThermal?: boolean | null;                 showRefTl?: boolean | null;
    showDevice?: boolean | null;              showDeviceThermal?: boolean | null;              showDeviceTl?: boolean | null;
    showFooter?: boolean | null;              showFooterThermal?: boolean | null;              showFooterTl?: boolean | null;
    // Slip sign-off rows — optional so reads tolerate the pre-`db push` window.
    showSentBy?: boolean | null;              showSentByThermal?: boolean | null;
    showReceivedBy?: boolean | null;          showReceivedByThermal?: boolean | null;
    showPreparedBy?: boolean | null;          showPreparedByThermal?: boolean | null;
    showFindings?: boolean | null;            showFindingsThermal?: boolean | null;
    termsText: string; footerLine: string; signatureLabel: string;
    disclaimerLine?: string | null; // guards the window before `prisma db push` adds the column
    defaultPaper: string; paperWidthMm: number; fontFamily: string; fontSizePx: number;
};

/**
 * Pure DB-row → VoucherTemplateDefaults mapper. The SINGLE place that shapes a
 * stored row into the render/edit template — reused by the print routes
 * (voucherTemplate.ts) and the settings pages so they can never drift. Each
 * boolean falls back to the kind's canonical default when the column is missing
 * (`?? fallback.showX` only fires on null/undefined, never on a stored `false`).
 */
export function rowToVoucherTemplateDefaults(row: VoucherPrintTemplateRow): VoucherTemplateDefaults {
    const kind = isVoucherTemplateKind(row.kind) ? row.kind : "SALE";
    const f = buildVoucherTemplateDefaults(kind);
    return {
        kind,
        headerLine1:  row.headerLine1,
        headerLine2:  row.headerLine2,
        addressBlock: row.addressBlock,
        gstinLine:    row.gstinLine,
        phoneLine:    row.phoneLine,
        logoUrl:      row.logoUrl,
        showLogo:                 row.showLogo                 ?? f.showLogo,
        showLogoThermal:          row.showLogoThermal          ?? f.showLogoThermal,
        showHeaderText:           row.showHeaderText           ?? f.showHeaderText,
        showHeaderTextThermal:    row.showHeaderTextThermal    ?? f.showHeaderTextThermal,
        showAddress:              row.showAddress              ?? f.showAddress,
        showAddressThermal:       row.showAddressThermal       ?? f.showAddressThermal,
        showBranchAddress:        row.showBranchAddress        ?? f.showBranchAddress,
        showBranchAddressThermal: row.showBranchAddressThermal ?? f.showBranchAddressThermal,
        showGstin:                row.showGstin                ?? f.showGstin,
        showGstinThermal:         row.showGstinThermal         ?? f.showGstinThermal,
        showPhone:                row.showPhone                ?? f.showPhone,
        showPhoneThermal:         row.showPhoneThermal         ?? f.showPhoneThermal,
        showTaxSummary:           row.showTaxSummary           ?? f.showTaxSummary,
        showTaxSummaryThermal:    row.showTaxSummaryThermal    ?? f.showTaxSummaryThermal,
        showMrp:                  row.showMrp                  ?? f.showMrp,
        showMrpThermal:           row.showMrpThermal           ?? f.showMrpThermal,
        showSignature:            row.showSignature            ?? f.showSignature,
        showSignatureThermal:     row.showSignatureThermal     ?? f.showSignatureThermal,
        showQrCode:               row.showQrCode               ?? f.showQrCode,
        showBarcode:              row.showBarcode              ?? f.showBarcode,
        showBarcodeThermal:       row.showBarcodeThermal       ?? f.showBarcodeThermal,
        showBank:                 row.showBank                 ?? f.showBank,
        showBankThermal:          row.showBankThermal          ?? f.showBankThermal,
        showPartyBalance:         row.showPartyBalance         ?? f.showPartyBalance,
        showPartyBalanceThermal:  row.showPartyBalanceThermal  ?? f.showPartyBalanceThermal,
        showTicket:               row.showTicket               ?? f.showTicket,
        showTicketThermal:        row.showTicketThermal        ?? f.showTicketThermal,
        showTicketTl:             row.showTicketTl             ?? f.showTicketTl,
        showDate:                 row.showDate                 ?? f.showDate,
        showDateThermal:          row.showDateThermal          ?? f.showDateThermal,
        showDateTl:               row.showDateTl               ?? f.showDateTl,
        showRef:                  row.showRef                  ?? f.showRef,
        showRefThermal:           row.showRefThermal           ?? f.showRefThermal,
        showRefTl:                row.showRefTl                ?? f.showRefTl,
        showDevice:               row.showDevice               ?? f.showDevice,
        showDeviceThermal:        row.showDeviceThermal        ?? f.showDeviceThermal,
        showDeviceTl:             row.showDeviceTl             ?? f.showDeviceTl,
        showFooter:               row.showFooter               ?? f.showFooter,
        showFooterThermal:        row.showFooterThermal        ?? f.showFooterThermal,
        showFooterTl:             row.showFooterTl             ?? f.showFooterTl,
        showSentBy:               row.showSentBy               ?? f.showSentBy,
        showSentByThermal:        row.showSentByThermal        ?? f.showSentByThermal,
        showReceivedBy:           row.showReceivedBy           ?? f.showReceivedBy,
        showReceivedByThermal:    row.showReceivedByThermal    ?? f.showReceivedByThermal,
        showPreparedBy:           row.showPreparedBy           ?? f.showPreparedBy,
        showPreparedByThermal:    row.showPreparedByThermal    ?? f.showPreparedByThermal,
        showFindings:             row.showFindings             ?? f.showFindings,
        showFindingsThermal:      row.showFindingsThermal      ?? f.showFindingsThermal,
        termsText:      row.termsText,
        footerLine:     row.footerLine,
        signatureLabel: row.signatureLabel,
        disclaimerLine: row.disclaimerLine ?? f.disclaimerLine,
        defaultPaper:   isPaperFormat(row.defaultPaper) ? row.defaultPaper : f.defaultPaper,
        paperWidthMm:   row.paperWidthMm,
        fontFamily:     row.fontFamily,
        fontSizePx:     row.fontSizePx,
    };
}

/**
 * Collapse the A4 + thermal flag pairs down to the single set of `showX` flags
 * that applies to the given print format. The base `showX` names carry the A4
 * values; for THERMAL_80MM we swap in each `showXThermal`. Renderers then read
 * plain `showX` and stay format-agnostic. Call this once, at the point the
 * paper format is known (ReceiptPreview + the bespoke repair prints).
 */
export function resolveTemplateForFormat(
    t: VoucherTemplateDefaults,
    format: PaperFormat,
): VoucherTemplateDefaults {
    if (format !== "THERMAL_80MM") return t; // base names are already the A4 flags
    return {
        ...t,
        showLogo:          t.showLogoThermal,
        showHeaderText:    t.showHeaderTextThermal,
        showAddress:       t.showAddressThermal,
        showBranchAddress: t.showBranchAddressThermal,
        showGstin:         t.showGstinThermal,
        showPhone:         t.showPhoneThermal,
        showTaxSummary:    t.showTaxSummaryThermal,
        showMrp:           t.showMrpThermal,
        showSignature:     t.showSignatureThermal,
        showBarcode:       t.showBarcodeThermal,
        showBank:          t.showBankThermal,
        showPartyBalance:  t.showPartyBalanceThermal,
        showSentBy:        t.showSentByThermal,
        showReceivedBy:    t.showReceivedByThermal,
        showPreparedBy:    t.showPreparedByThermal,
        showFindings:      t.showFindingsThermal,
    };
}
