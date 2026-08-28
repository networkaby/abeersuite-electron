import { InvVoucherType, type Prisma } from "@/generated/prisma/client";
import { nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { round2 } from "@/shared/lib/format";

// ── Reference number generation ───────────────────────────────────────────────

// Inventory-voucher types that have a configurable VoucherSeries row managed
// from /office/settings/year-ending (FY rollover, padding, separators, type code).
// Anything not listed here falls through to the legacy calendar-year scheme.
const SERIES_KINDS: Partial<Record<InvVoucherType, string>> = {
    SALE: "SALE",
    POS: "POS",
    PURCHASE: "PURCHASE",
    ESTIMATE: "ESTIMATE",
    // POS_ESTIMATE / POS_ORDER deliberately use the legacy PREFIX fallback below
    // (POSEV-/POSOD- calendar-year) so they need no seeded VoucherSeries row.
    SALE_RETURN: "SALE_RETURN",
    PURCHASE_RETURN: "PURCHASE_RETURN",
    SALES_ORDER: "SALES_ORDER",
    PURCHASE_ORDER: "PURCHASE_ORDER",
    GRN: "GRN",
    CHALLAN: "CHALLAN",
    MANUFACTURING_JOURNAL: "MANUFACTURING_JOURNAL",
    PHYSICAL_STOCK: "PHYSICAL_STOCK",
    BRANCH_TRANSFER: "BRANCH_TRANSFER",
    REJECTION_IN: "REJECTION_IN",
    REJECTION_OUT: "REJECTION_OUT",
};

// Legacy prefixes for the fallback path — kept for any voucher types
// not promoted to the configurable VoucherSeries system.
const PREFIX: Record<InvVoucherType, string> = {
    PURCHASE: "PV",
    SALE: "SV",
    POS: "POS",
    ONLINE_INVOICE: "OI",
    ONLINE_ORDER: "OO",
    ESTIMATE: "EV",
    POS_ESTIMATE: "POSEV",
    POS_ORDER: "POSOD",
    SALE_RETURN: "SR",
    PURCHASE_RETURN: "PR",
    MANUFACTURING_JOURNAL: "MJ",
    PHYSICAL_STOCK: "PS",
    BRANCH_TRANSFER: "BT",
    GRN: "GRN",
    CHALLAN: "DC",
    REJECTION_IN: "RIN",
    REJECTION_OUT: "ROUT",
    SALES_ORDER: "SO",
    PURCHASE_ORDER: "PO",
};

/**
 * Generate sequential inventory voucher references.
 *
 * SALE / PURCHASE / ESTIMATE route through `nextRefFromSeries` so they pick
 * up the FY-aware convention managed at /office/settings/year-ending — same
 * formatting (FY_SHORT, padding, separators) the GL vouchers use.
 *
 * Other inventory voucher types not in SERIES_KINDS fall back to the legacy
 * calendar-year `${prefix}-YYYY-####` scheme.
 *
 * Must be called inside a prisma.$transaction to be safe against races.
 */
export async function invNextRef(
    tx: Prisma.TransactionClient,
    type: InvVoucherType,
    ctx?: import("@/modules/accountancy/lib/voucherRef").ReferenceContext,
): Promise<string> {
    const seriesKind = SERIES_KINDS[type];
    if (seriesKind) {
        return nextRefFromSeries(tx, seriesKind, ctx);
    }
    // Legacy fallback — calendar-year prefix scheme.
    const year = new Date().getFullYear();
    const prefix = PREFIX[type];
    const cleanCounter = counterCode && counterCode.trim() ? `${counterCode.trim().padStart(2, "0")}-` : "";
    const startsWith = `${cleanCounter}${prefix}-${year}-`;
    const count = await tx.voucherDetail.count({ where: { universalVoucher: { voucherNo: { startsWith } } } });   // 5D-6: ref on spine
    return `${startsWith}${String(count + 1).padStart(4, "0")}`;
}

// ── Line totals helper ─────────────────────────────────────────────────────────

export type VoucherLineInput = {
    quantity: number;
    rate: number;
    discountPct: number;
    discountAmt: number;
    taxRate: number;
};

/**
 * Compute per-line amounts: discountAmt, taxAmount, amount.
 *
 * Rounds discountAmt / taxAmount / amount to 2dp (paise) at each stage —
 * same convention the line-entry UI uses when it stores a typed/derived
 * taxAmount via `.toFixed(2)`. Without this, a tax-inclusive rate that
 * doesn't divide evenly (e.g. ₹2100 incl. 18% → ₹1779.661016...) carries
 * float precision past 2dp, and the server's re-derived total drifts a
 * paisa or two from the client's rounded-per-line total — tripping the
 * tenders-sum-must-match-total check on an otherwise-correct invoice.
 */
export function calcLineTotals(l: VoucherLineInput): {
    discountAmt: number;
    taxAmount: number;
    amount: number;
} {
    const gross = l.quantity * l.rate;
    const discAmt = round2(l.discountAmt > 0 ? l.discountAmt : gross * (l.discountPct / 100));
    const taxable = gross - discAmt;
    const taxAmount = round2(taxable * (l.taxRate / 100));
    const amount = round2(taxable + taxAmount);
    return { discountAmt: discAmt, taxAmount, amount };
}

/** Compute voucher-level totals from computed lines.
 *
 * `chargesNet` is the signed sum of additional GL legs (the "+ Add Account"
 * rows below the items table — packing income, service charges, etc.).
 * Positive amounts increase the bill on sale-side / our payment on
 * purchase-side; negative amounts decrease it. See InvVoucherCharge in
 * inventory.prisma for the direction convention.
 */
export function calcVoucherTotals(
    lines: { amount: number; taxAmount: number }[],
    shippingAmt = 0,
    discountAmt = 0,
    roundOff = 0,
    chargesNet = 0,
): { subtotal: number; taxAmount: number; totalAmount: number } {
    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const taxAmount = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
    const totalAmount = round2(subtotal + shippingAmt - discountAmt + roundOff + chargesNet);
    return { subtotal, taxAmount, totalAmount };
}

// ── Shipping GST rate (composite-supply rule) ─────────────────────────────────

/** GST rate (%) the shipping charge inherits from the bill's lines.
 *
 * Freight charged by the seller is part of the value of supply (CGST Act
 * §15(2)(c)), taxed at the principal supply's rate. Principal = the rate
 * group holding MORE than 50% of the bill's pre-tax, pre-discount value
 * (`qty × unitPrice`); a truly mixed bill (no group crosses 50%, ties
 * included) falls back to the highest rate on the bill.
 *
 * Callers pass GOODS lines; a service-only bill passes its service lines
 * instead (same rule over service rates). Client and server both use this
 * helper so the displayed hint and the posted tax never drift.
 * Empty input → 0 (nothing to inherit — e.g. an all-exempt bill stays 0%).
 */
export function resolveShippingGstRate(
    lines: { value: number; taxRate: number }[],
): number {
    const totalValue = lines.reduce((s, l) => s + Math.max(0, l.value), 0);
    if (totalValue <= 0) return 0;
    const byRate = new Map<number, number>();
    for (const l of lines) {
        byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? 0) + Math.max(0, l.value));
    }
    let maxRate = 0;
    for (const [rate, value] of byRate) {
        if (value / totalValue > 0.5) return rate;   // dominant principal supply
        if (rate > maxRate) maxRate = rate;
    }
    return maxRate;                                   // mixed bill → highest rate
}
