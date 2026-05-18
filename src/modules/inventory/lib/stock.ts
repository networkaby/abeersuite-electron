import { InvVoucherType, type Prisma } from "@/generated/prisma/client";
import { nextRefFromSeries } from "@/modules/accountancy/lib/balance";

// ── Reference number generation ───────────────────────────────────────────────

// Inventory-voucher types that have a configurable VoucherSeries row managed
// from /office/admin/year-ending (FY rollover, padding, separators, type code).
// Anything not listed here falls through to the legacy calendar-year scheme.
const SERIES_KINDS: Partial<Record<InvVoucherType, string>> = {
    SALE:             "SALE",
    POS:              "POS",
    PURCHASE:         "PURCHASE",
    ESTIMATE:         "ESTIMATE",
    SALE_RETURN:      "SALE_RETURN",
    PURCHASE_RETURN:  "PURCHASE_RETURN",
};

// Legacy prefixes for the fallback path — kept so older voucher types
// (RECEIPT/ISSUE/etc.) still get a sane default reference until / unless
// they're promoted to the configurable VoucherSeries system.
const PREFIX: Record<InvVoucherType, string> = {
    PURCHASE:         "PV",
    SALE:             "SV",
    POS:              "POS",
    ESTIMATE:         "EV",
    SALE_RETURN:      "SR",
    PURCHASE_RETURN:  "PR",
    RECEIPT:          "RV",
    ISSUE:            "IV",
    ADJUSTMENT:       "AV",
    MANUFACTURING_JOURNAL: "MJ",
    PHYSICAL_STOCK:   "PS",
    BRANCH_TRANSFER:  "BT",
    GRN:              "GRN",
    CHALLAN:          "DC",
    REJECTION_IN:     "RIN",
    REJECTION_OUT:    "ROUT",
    SALES_ORDER:      "SO",
    PURCHASE_ORDER:   "PO",
};

/**
 * Generate sequential inventory voucher references.
 *
 * SALE / PURCHASE / ESTIMATE route through `nextRefFromSeries` so they pick
 * up the FY-aware convention managed at /office/admin/year-ending — same
 * formatting (FY_SHORT, padding, separators) the GL vouchers use.
 *
 * Other inventory voucher types (RECEIPT, ISSUE, GRN, etc.) keep the legacy
 * calendar-year `${prefix}-YYYY-####` scheme until they're promoted.
 *
 * Must be called inside a prisma.$transaction to be safe against races.
 */
export async function invNextRef(
    tx: Prisma.TransactionClient,
    type: InvVoucherType,
    userId?: number | null,
): Promise<string> {
    const seriesKind = SERIES_KINDS[type];
    if (seriesKind) {
        return nextRefFromSeries(tx, seriesKind, userId ?? undefined);
    }
    // Legacy fallback — calendar-year prefix scheme.
    const year = new Date().getFullYear();
    const prefix = PREFIX[type];
    const startsWith = `${prefix}-${year}-`;
    const count = await tx.invVoucher.count({ where: { reference: { startsWith } } });
    return `${startsWith}${String(count + 1).padStart(4, "0")}`;
}

// ── Line totals helper ─────────────────────────────────────────────────────────

export type VoucherLineInput = {
    quantity:    number;
    rate:        number;
    discountPct: number;
    discountAmt: number;
    taxRate:     number;
};

/** Compute per-line amounts: discountAmt, taxAmount, amount */
export function calcLineTotals(l: VoucherLineInput): {
    discountAmt: number;
    taxAmount:   number;
    amount:      number;
} {
    const gross      = l.quantity * l.rate;
    const discAmt    = l.discountAmt > 0 ? l.discountAmt : gross * (l.discountPct / 100);
    const taxable    = gross - discAmt;
    const taxAmount  = taxable * (l.taxRate / 100);
    const amount     = taxable + taxAmount;
    return { discountAmt: discAmt, taxAmount, amount };
}

/** Compute voucher-level totals from computed lines */
export function calcVoucherTotals(
    lines: { amount: number; taxAmount: number }[],
    shippingAmt = 0,
    discountAmt = 0,
    roundOff    = 0,
): { subtotal: number; taxAmount: number; totalAmount: number } {
    const subtotal  = lines.reduce((s, l) => s + l.amount, 0);
    const taxAmount = lines.reduce((s, l) => s + l.taxAmount, 0);
    const totalAmount = subtotal + shippingAmt - discountAmt + roundOff;
    return { subtotal, taxAmount, totalAmount };
}
