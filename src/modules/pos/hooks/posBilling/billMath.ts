// Pure bill maths of usePosBilling — no React, no fetch. Moved out of the hook
// unchanged so it can be unit-tested (billMath.test.ts). Each piece mirrors
// /api/pos/sale; keep the two in step.

import { calcVoucherTotals } from "@/modules/inventory/lib/voucherMath";
import { parseDigitsInput, round2 } from "@/shared/lib/format";
import { floorExclFromPaise } from "@/modules/pricing-strategy/lib/priceFloor";
import type { CartLine, Snapshot } from "@/modules/pos/lib/posDraftTypes";
import type { EditBill } from "./types";

/** Pre-tax lowest price a cashier may type on a line — the item's sale price
 *  (tax-inclusive paise) backed out to exclusive. null = no floor (service,
 *  or no sale price on the line). Hydrated edit / converted lines never carry
 *  salePaise, so an old bill sold below today's sale price still re-saves —
 *  keep it that way. */
export function lineFloorExcl(l: CartLine): number | null {
    if (l.kind === "service") return null;
    return floorExclFromPaise(l.salePaise, l.taxRate);
}

// ── Loyalty redemption (mirrors the server) ───────────────────────────────
// Redemption rides a negative charge to the dedicated "Loyalty Points
// Redeemed" ledger, so it folds into chargesNet here exactly as the server
// folds it into calcVoucherTotals. We clamp to balance + bill caps client-
// side so we only ever send the route a value it will accept.
export function loyaltyRedemption(args: {
    eb: EditBill | null | undefined;
    snapshot: Pick<Snapshot, "loyaltyRates" | "loyaltyPoints"> | null | undefined;
    cart: CartLine[];
    lineRows: { amount: number; taxAmount: number; gross: number }[];
    shippingAmt: number;
    discountAmount: number;
    manualChargesNet: number;
    floorRoom: number;
    editLinesUnchanged: boolean;
    redeemOn: boolean;
    redeemPointsStr: string;
    lineProtected: (l: CartLine) => boolean;
}) {
    const { eb, snapshot, cart, lineRows, shippingAmt, discountAmount, manualChargesNet, floorRoom, editLinesUnchanged, redeemOn, redeemPointsStr, lineProtected } = args;
// An edit redeems at its sale day's rates, up to the points it may use (posSaleEdit.ts).
const rates = eb ? eb.promo.loyaltyRates : snapshot?.loyaltyRates ?? null;
// Redemption is live only while the programme AND its redeem gate are on.
const canRedeem = !!rates?.enabled && !!rates?.redeemEnabled;
const loyaltyBalance = eb ? eb.maxRedeem : snapshot?.loyaltyPoints ?? 0;
const minRedeemPts = rates?.minRedeemPoints ?? 0;
// Pre-redemption bill — used to enforce the min-invoice-to-redeem floor.
const billBeforeRedemption = calcVoucherTotals(lineRows, shippingAmt, discountAmount, 0, manualChargesNet).totalAmount;
const redeemBlocked = rates?.minRedeemInvoiceValue != null && billBeforeRedemption < rates.minRedeemInvoiceValue;
// Cart-aware redeem ceiling — Σ (line net × that item's redeem cap %), with the
// global cap as the per-line default (null → 100%). Mirrors the server's
// redeemableBaseForCart so the bill total + payment check always agree.
const globalCapPct = rates?.maxRedeemPctOfBill ?? null;
// Loyalty redeems against GOODS only — service lines stay out of the base,
// mirroring the server (earnLines / redeemableBaseForCart see body.lines,
// which carry products only). Discount-protected lines are dropped too: no
// redemption against a protected product (mirrors the server's blacklist).
const goodsCart = cart.filter((l) => l.kind !== "service" && !lineProtected(l));
const cartGoods = goodsCart.reduce((s, l) => s + l.qty * l.unitPrice, 0);
const maxRedeemableRupees = cartGoods <= 0 ? 0 : goodsCart.reduce((acc, l) => {
    const lineGoods = l.qty * l.unitPrice;
    const allocated = discountAmount * (lineGoods / cartGoods);
    const net = Math.max(0, lineGoods - allocated);
    const cap = l.redeemCapPct ?? globalCapPct;
    const frac = cap == null ? 1 : Math.max(0, Math.min(100, cap)) / 100;
    return acc + net * frac;
}, 0);
const requestedPts = canRedeem && redeemOn && !redeemBlocked ? parseInt(parseDigitsInput(redeemPointsStr) || "0", 10) : 0;
// The wall: points may only take what the tier discount left above the floor.
const wallRedeemRupees = Math.min(maxRedeemableRupees, Math.max(0, floorRoom - discountAmount));
const cartCapPts = rates && rates.redeemValue > 0 ? Math.floor(wallRedeemRupees / rates.redeemValue) : 0;
// The points an unchanged edit already redeemed stay redeemable whatever the cap reads now.
const maxRedeemablePts = eb && editLinesUnchanged ? Math.max(cartCapPts, eb.redeemedBefore) : cartCapPts;
const cappedPts = Math.min(requestedPts, loyaltyBalance, maxRedeemablePts);
const redeemPts = cappedPts >= minRedeemPts || (eb != null && cappedPts === eb.redeemedBefore) ? cappedPts : 0;
const redemptionRupees = eb && redeemPts === eb.redeemedBefore
    ? eb.redeemRupeesBefore
    : rates ? redeemPts * rates.redeemValue : 0;
    return { rates, canRedeem, loyaltyBalance, redeemBlocked, maxRedeemablePts, redeemPts, redemptionRupees };
}

// ── Headroom (staff hint on the POS line) ───────────────────────────────────
// Incl ₹ a cashier may still cut by hand before a line hits its sale price:
// (price − floor) − the line's own level discount − its share of the bill-wide
// cuts (loyalty, coupon, on-top free item), shared by line value. Display only.
export function lineHeadroom(cart: CartLine[], lineTierAfterCoupon: number[], billWideCuts: number) {
const lineRoomIncl = cart.map((l, i) => {
    const floor = lineFloorExcl(l);
    if (floor == null) return null;
    const k = 1 + l.taxRate / 100;
    return (l.qty * (l.unitPrice - floor) - lineTierAfterCoupon[i]) * k;
});
const roomBase = cart.reduce((s, l, i) => s + (lineRoomIncl[i] != null ? l.qty * l.unitPrice : 0), 0);
// Keyed by the line itself — the screen lists renderCart, not cart order.
const lineGapRupees = new Map<CartLine, number>();
cart.forEach((l, i) => {
    const room = lineRoomIncl[i];
    if (room == null || l.qty <= 0) return;
    const share = roomBase > 0 ? billWideCuts * (l.qty * l.unitPrice) / roomBase : 0;
    lineGapRupees.set(l, round2((room - share) / l.qty)); // per piece, what the price box moves by
});
const totalGapRupees = lineRoomIncl.some((r) => r != null)
    ? round2(lineRoomIncl.reduce<number>((s, r) => s + (r ?? 0), 0) - billWideCuts)
    : null;
    return { lineGapRupees, totalGapRupees };
}
