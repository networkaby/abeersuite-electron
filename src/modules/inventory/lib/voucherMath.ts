// ── Voucher arithmetic ────────────────────────────────────────────────────────
//
// The pure maths behind a bill: per-line amounts, voucher totals, and the GST
// rate shipping inherits. Split out of stock.ts so the POS screens can import it
// WITHOUT dragging the server in — stock.ts reaches accountancy/balance.ts, which
// reaches the counter release guard, which reaches `fs` and Prisma. Turbopack
// merged that whole chain into the browser chunk and the build refused it.
//
// Nothing here touches the database, the filesystem or Prisma. Keep it that way:
// this file is imported by client components.

import { round2 } from "@/shared/lib/format";

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

/** The exact pre-tax rate a saved line was totalled from.
 *
 * The rate column keeps 2 decimals, but a line typed at a GST-inclusive price
 * (60 × ₹20 at 18%) was totalled from the exact rate (₹16.949…): saved rate
 * ₹16.95, saved amount ₹1,200. Recomputing from the rounded rate gives ₹1,200.06.
 * Rebuilt from the saved amount instead (amount = (qty × rate − disc) × (1 + GST%)),
 * so a line re-totalled on Convert or on an edit comes out to the paisa it was
 * billed at. No quantity → the saved rate as it is. */
export function exactLineRate(l: { quantity: unknown; rate: unknown; amount: unknown; taxRate: unknown; discountAmt?: unknown }): number {
    const qty = Number(l.quantity);
    if (!(qty > 0)) return Number(l.rate);
    return (Number(l.amount) / (1 + Number(l.taxRate) / 100) + Number(l.discountAmt ?? 0)) / qty;
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
