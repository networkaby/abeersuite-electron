/**
 * Single source of truth for VoucherPrintTemplate kinds and their defaults.
 *
 * Used by:
 *   • prisma/seeds/bootstrap-seed.ts        — initial upsert of all 21 rows
 *   • /api/settings/voucher-templates/...   — list-auto-upsert, reset-to-default
 *   • /office/settings/voucher-templates    — UI grouping (Accounting / Inventory)
 *   • src/shared/lib/print/voucherTemplate.ts — runtime fallback if a row is missing
 *
 * Keep `VOUCHER_TEMPLATE_KIND_GROUPS` aligned with the VoucherType + InvVoucherType
 * enums in prisma/schema/enums.prisma. If you add a kind to either enum, add it
 * here too (the bootstrap seed re-runs upserts so adding a new kind is a one-line
 * change followed by a re-seed).
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

export const VOUCHER_TEMPLATE_KINDS = [
    ...ACCOUNTING_VOUCHER_KINDS,
    ...INVENTORY_VOUCHER_KINDS,
] as const;

export type VoucherTemplateKind = (typeof VOUCHER_TEMPLATE_KINDS)[number];

export const VOUCHER_TEMPLATE_KIND_GROUPS = {
    accounting: ACCOUNTING_VOUCHER_KINDS,
    inventory:  INVENTORY_VOUCHER_KINDS,
} as const;

// Human-readable per-kind sub-titles that go into headerLine2 by default.
// Kept verbose for clarity on a thermal slip — admin can shorten via the UI.
const HEADER_LINE_2: Record<VoucherTemplateKind, string> = {
    CONTRA:                "Contra Voucher",
    PAYMENT:               "Payment Voucher",
    RECEIPT:               "Receipt Voucher",
    CREDIT_NOTE:           "Credit Note",
    DEBIT_NOTE:            "Debit Note",
    JOURNAL:               "Journal Voucher",

    PURCHASE:              "Purchase Invoice",
    SALE:                  "Tax Invoice",
    POS:                   "POS sale receipt",
    ESTIMATE:              "Estimate / Quotation",
    POS_ESTIMATE:          "Estimate / Quotation",
    POS_ORDER:             "Order Confirmation",
    SALE_RETURN:           "Sale Return",
    PURCHASE_RETURN:       "Purchase Return",
    MANUFACTURING_JOURNAL: "Manufacturing Journal",
    PHYSICAL_STOCK:        "Physical Stock Voucher",
    BRANCH_TRANSFER:       "Branch Transfer",
    GRN:                   "Goods Receipt Note",
    CHALLAN:               "Delivery Challan",
    REJECTION_IN:          "Rejection In",
    REJECTION_OUT:         "Rejection Out",
    SALES_ORDER:           "Sales Order",
    PURCHASE_ORDER:        "Purchase Order",
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
]);

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
};

export interface VoucherTemplateDefaults {
    kind:           VoucherTemplateKind;
    headerLine1:    string;
    headerLine2:    string;
    addressBlock:   string;
    gstinLine:      string;
    phoneLine:      string;
    logoUrl:        string;
    showLogo:       boolean;
    showAddress:    boolean;
    showGstin:      boolean;
    showPhone:      boolean;
    showTaxSummary: boolean;
    showMrp:        boolean;
    showSignature:  boolean;
    showQrCode:     boolean;
    termsText:      string;
    footerLine:     string;
    signatureLabel: string;
    defaultPaper:   PaperFormat;
    paperWidthMm:   number;
    fontFamily:     string;
    fontSizePx:     number;
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
        headerLine1:    "",
        headerLine2:    HEADER_LINE_2[kind],
        addressBlock:   "",
        gstinLine:      "",
        phoneLine:      "",
        logoUrl:        "",
        showLogo:       false,
        showAddress:    true,
        showGstin:      true,
        showPhone:      true,
        showTaxSummary: !NO_TAX_SUMMARY.has(kind),
        showMrp:        true,
        showSignature:  false,
        showQrCode:     false,
        termsText:      "",
        footerLine:     "Thank you · Visit again",
        signatureLabel: "Authorised Signatory",
        defaultPaper:   DEFAULT_PAPER_BY_KIND[kind],
        paperWidthMm:   80,
        fontFamily:     "Courier New, monospace",
        fontSizePx:     12,
    };
}

export function isVoucherTemplateKind(value: string): value is VoucherTemplateKind {
    return (VOUCHER_TEMPLATE_KINDS as readonly string[]).includes(value);
}
