// ── usePosBilling: input types and the amount parser ────────────────────────
// Shared by the hook (usePosBilling.ts) and the screens that drive it. The
// hook re-exports both, so `import { parseAmt, type EditBill } from
// "@/modules/pos/hooks/usePosBilling"` keeps working.

import { type ActiveShift } from "@/modules/pos/components/ActiveShiftBar";
import type { PromoSnapshot } from "@/shared/lib/accountancy/settlement";

// A POS text box's string → number; anything that isn't a plain number
// (empty, "1,000", "12abc") reads as 0. Stricter than the shared
// `parseSignedAmount`, which strips grouping — kept as is on purpose.
// Project rule: no <input type="number">; we keep raw strings in state and
// parse on submit / when computing totals.
export function parseAmt(s: string): number {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

/** A posted POS sale being re-saved — see `editBill` below and posSaleEdit.ts,
 *  which the PATCH checks every figure here against. */
export type EditBill = {
    /** The saved lines, in order, with the level discount each carried (₹, before GST). */
    lines: { productId: number; qty: number; unitPrice: number; discountAmt: number }[];
    shippingAmt: number;
    /** Saved round-off — kept while the bill comes to what it was. */
    roundOff: number;
    /** Net of the saved charge rows other than loyalty and coupon (services at gross). */
    chargesNet: number;
    /** The coupon the sale used — kept as it was; no new coupon on an edit. */
    coupon: { code: string; rupees: number } | null;
    /** The offers the sale was rung under (tier %, loyalty rates). */
    promo: PromoSnapshot;
    /** Points the sale redeemed, their ₹, and the most the edit may redeem. */
    redeemedBefore: number;
    redeemRupeesBefore: number;
    maxRedeem: number;
    /** The gift card it drew: that draw plus what is on the card today may be used. */
    gift: { code: string | null; usedBefore: number; availableNow: number } | null;
    /** The payment accounts of the counter the sale was rung on (null = a sale
     *  with no shift; the editor's own counter takes the payment). */
    payAccounts: ActiveShift["counter"]["paymentAccounts"] | null;
    /** How the sale was paid — what a plain checkout open starts from. */
    savedPayments: { cash: number; splits: { paymentAccountId: number; amount: number; reference: string }[] };
};
