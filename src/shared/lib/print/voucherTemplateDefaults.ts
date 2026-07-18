/**
 * Single source of truth for VoucherPrintTemplate kinds and their defaults.
 * "Print templates" is the customer-facing name; the model + `kind` PK are a
 * generic per-document print registry — accountancy vouchers AND the repair-shop
 * documents (repair ticket, shipping slip) all live here.
 *
 * Used by:
 *   • prisma/seeds/bootstrap-seed.ts        — initial upsert of all 25 rows
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
    "CONTRA",
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
] as const;

export const VOUCHER_TEMPLATE_KINDS = [
    ...ACCOUNTING_VOUCHER_KINDS,
    ...INVENTORY_VOUCHER_KINDS,
    ...REPAIR_DOCUMENT_KINDS,
] as const;

export type VoucherTemplateKind = (typeof VOUCHER_TEMPLATE_KINDS)[number];

export const VOUCHER_TEMPLATE_KIND_GROUPS = {
    accounting: ACCOUNTING_VOUCHER_KINDS,
    inventory: INVENTORY_VOUCHER_KINDS,
    repair: REPAIR_DOCUMENT_KINDS,
} as const;

// Human-readable per-kind sub-titles that go into headerLine2 by default.
// Kept verbose for clarity on a thermal slip — admin can shorten via the UI.
const HEADER_LINE_2: Record<VoucherTemplateKind, string> = {
    CONTRA: "Contra Voucher",
    PAYMENT: "Payment Voucher",
    RECEIPT: "Receipt Voucher",
    CREDIT_NOTE: "Credit Note",
    DEBIT_NOTE: "Debit Note",
    JOURNAL: "Journal Voucher",

    PURCHASE: "Purchase Invoice",
    SALE: "Tax Invoice",
    POS: "POS sale receipt",
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
    SHIPPING_SLIP: "Shipping Slip / Delivery Challan",
};

// Voucher kinds that don't have a monetary tax breakdown by their nature.
// We start them with showTaxSummary=false so the seeded preview matches reality.
const NO_TAX_SUMMARY: ReadonlySet<VoucherTemplateKind> = new Set<VoucherTemplateKind>([
    "CONTRA",
    "JOURNAL",
    "MANUFACTURING_JOURNAL",
    "PHYSICAL_STOCK",
    "BRANCH_TRANSFER",
    "REJECTION_IN",
    "REJECTION_OUT",
    // Repair-shop documents carry no ledger / tax table.
    "REPAIR_TICKET",
    "SHIPPING_SLIP",
]);

// Repair-shop documents that show customer + staff signature lines by default.
const WITH_SIGNATURE: ReadonlySet<VoucherTemplateKind> = new Set<VoucherTemplateKind>([
    "REPAIR_TICKET",
]);

// Kinds that print a scannable barcode of the voucher number by default — the
// invoices a customer keeps and may bring back, so a return clerk can scan the
// slip to pull up the original sale. Applies to both A4 + thermal seeds; the
// two flags can then be tuned independently per format.
const BARCODE_KINDS: ReadonlySet<VoucherTemplateKind> = new Set<VoucherTemplateKind>([
    "SALE",
    "POS",
    "SALE_RETURN",
]);

// Per-kind default footer / terms overrides (blank kinds fall back to the
// generic footer and empty terms). The repair ticket seeds the shop's standard
// service terms so they render out-of-the-box AND stay editable on the
// print-templates settings page.
const FOOTER_LINE_BY_KIND: Partial<Record<VoucherTemplateKind, string>> = {
    REPAIR_TICKET: "Thank you for your trust!",
    SHIPPING_SLIP: "Please return the device with this slip.",
};

const DEFAULT_DISCLAIMER_LINE = "This is a computer-generated document and does not require a signature.";

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
    PAYMENT: "A4",
    RECEIPT: "A4",
    CREDIT_NOTE: "A4",
    DEBIT_NOTE: "A4",
    JOURNAL: "A4",
    PURCHASE: "A4",
    SALE: "A4",
    POS: "THERMAL_80MM",
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
};

// Per-kind default for the voucher form's "Print after save" toggle
// (true = print by default, false = off). This is the SINGLE place to set each
// voucher's print default — every voucher form seeds its toggle from here via
// printAfterSaveDefault(). The user can still flip the toggle per voucher on the
// form. POS / online channels manage their own printing and ignore this map.
export const PRINT_AFTER_SAVE_DEFAULT_BY_KIND: Record<VoucherTemplateKind, boolean> = {
    CONTRA: false,
    PAYMENT: false,
    RECEIPT: true,
    CREDIT_NOTE: false,
    DEBIT_NOTE: false,
    JOURNAL: false,
    PURCHASE: false,
    SALE: true,
    POS: true,
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
    PAYMENT:               true,
    RECEIPT:               true,
    CREDIT_NOTE:           false,
    DEBIT_NOTE:            false,
    JOURNAL:               false,
    PURCHASE:              false,
    SALE:                  false,
    POS:                   true,
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
    showQrCode: boolean; // dormant (not yet rendered)
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
 * `headerLine1` is intentionally left blank — the renderer falls back to
 * COMPANY_DETAILS.brandName so the seeded output matches the current
 * hardcoded receipts without baking the brand into the DB.
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
        showQrCode: false,
        termsText: TERMS_TEXT_BY_KIND[kind] ?? "",
        footerLine: FOOTER_LINE_BY_KIND[kind] ?? "Thank you · Visit again",
        signatureLabel: "Authorised Signatory",
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
    };
}
