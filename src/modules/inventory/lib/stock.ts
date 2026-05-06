import { InvVoucherType } from "@/generated/prisma/client";

// ── Reference number generation ───────────────────────────────────────────────

const PREFIX: Record<InvVoucherType, string> = {
    PURCHASE:       "PV",
    SALE:           "SV",
    ESTIMATE:       "EV",
    RECEIPT:        "RV",
    ISSUE:          "IV",
    ADJUSTMENT:     "AV",
    STOCK_JOURNAL:  "SJ",
    PHYSICAL_STOCK: "PS",
    GRN:            "GRN",
    CHALLAN:        "DC",
    REJECTION_IN:   "RIN",
    REJECTION_OUT:  "ROUT",
    SALES_ORDER:    "SO",
    PURCHASE_ORDER: "PO",
};

/**
 * Generate sequential inventory voucher references.
 * e.g. PV-2026-0001, SV-2026-0002
 * Must be called inside a prisma.$transaction to be safe against races.
 */
export async function invNextRef(
    tx: { invVoucher: { count: (a: object) => Promise<number> } },
    type: InvVoucherType,
): Promise<string> {
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
