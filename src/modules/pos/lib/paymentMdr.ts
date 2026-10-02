// Payment-method MDR — what a counter payment costs the shop in bank charge, and
// how much of it the bill takes back.
//
// The rule (owner, 2026-10-02): the bill the counter rings is the CASH price. A
// payment on a method with MDR (card; UPI above its free limit) raises the line
// rates toward each line's public tag, so the customer's "Today's discount" comes
// out smaller. A line never passes its tag; when the bill has no room left, the
// shop bears the charge. No charge row is added and nothing prints a fee — every
// printed figure is the posted figure.
//
// A big UPI payment may instead be taken in parts of up to the free limit
// (splitUpiAmount), each its own bank credit, so none of them carries MDR.
//
// Pure — no DB, no React. The POS screen (usePosBilling) and /api/pos/sale run
// these same functions on the same inputs, so the total the cashier collects is
// the total that posts. The rules themselves live on each method's configJson
// (paymentGateways.ts: MdrRule / SplitRule).

import { round2 } from "@/shared/lib/format";
import type { MdrRule, SplitRule } from "@/modules/pos/lib/paymentGateways";

const floor2 = (n: number): number => Math.floor(n * 100 + 1e-6) / 100;

/**
 * The UPI parts a payment of `amount` is taken in: as FEW as possible, each at
 * most `limit`, and every one a different amount so each bank credit can be told
 * apart — near-equal, a rupee or so between them (₹5,000 → 1,668 / 1,667 / 1,665).
 * Paise ride on the smallest part. When even `maxParts` parts cannot carry it, the
 * first maxParts−1 take the top amounts (limit, limit−1, …) and the last part takes
 * the rest, above the limit — that one payment carries MDR. One part when the
 * amount already fits.
 */
export function splitUpiAmount(amount: number, limit: number, maxParts: number): number[] {
    const total = round2(amount);
    if (total <= 0) return [];
    const top = Math.floor(limit);
    if (top <= 0 || maxParts < 2 || total <= top) return [total];

    // Most n distinct whole-rupee parts ≤ top can hold: top + (top−1) + … .
    const capacity = (n: number) => n * top - (n * (n - 1)) / 2;
    let n = 2;
    while (n < maxParts && capacity(n) < total) n++;

    if (capacity(n) < total) {
        const parts = Array.from({ length: maxParts - 1 }, (_, i) => top - i);
        const rest = round2(total - parts.reduce((s, p) => s + p, 0));
        return [...parts, rest];
    }

    // n consecutive rupees k … k+n−1, the top r of them one rupee higher so the
    // whole rupees add up exactly; the paise go on the smallest.
    const whole = Math.floor(total);
    const paise = round2(total - whole);
    const k = Math.floor((whole - (n * (n - 1)) / 2) / n);
    const r = whole - (n * k + (n * (n - 1)) / 2);
    const parts = Array.from({ length: n }, (_, i) => k + i + (i >= n - r ? 1 : 0));
    parts[0] = round2(parts[0] + paise);
    return parts.reverse();
}

/** The payment lines one checkout row becomes: its UPI parts when the method
 *  splits and the cashier has not chosen "one payment", else the row itself. */
export function tenderPayAmounts(
    amount: number,
    rule: MdrRule | null | undefined,
    split: SplitRule | null | undefined,
    oneGo: boolean,
): number[] {
    if (amount <= 0) return [];
    const limit = rule?.freeUpToRupees ?? 0;
    if (!split?.enabled || oneGo || limit <= 0) return [round2(amount)];
    return splitUpiAmount(amount, limit, split.maxParts);
}

/** MDR the bank takes on ONE payment of `amount` (rupees, unrounded): nothing up
 *  to the free limit, else ratePct of the whole payment, capped. */
export function mdrFee(amount: number, rule: MdrRule | null | undefined): number {
    if (!rule || rule.ratePct <= 0 || amount <= rule.freeUpToRupees) return 0;
    const fee = (amount * rule.ratePct) / 100;
    return rule.capRupees > 0 ? Math.min(rule.capRupees, fee) : fee;
}

/** What a set of payment lines costs in MDR — whole rupees. Cash, credit and a
 *  gift card are not payment lines here, so they never cost anything. */
export function mdrRecovery(lines: { amount: number; rule: MdrRule | null | undefined }[]): number {
    return Math.round(lines.reduce((s, l) => s + mdrFee(l.amount, l.rule), 0));
}

/** One bill line, as far as the MDR rise is concerned. */
export type UpliftLine = {
    quantity: number;
    /** Pre-tax unit rate the line posts at without MDR (after any group rebate). */
    rate: number;
    taxRate: number;
    /** Public tag, paise, GST-inclusive: the barcode price, else MRP — the number
     *  the receipt's price ladder shows. null = no tag, so no room. */
    tagPaise: number | null;
    /** Services and discount-protected lines never move. */
    fixed: boolean;
};

/** How far a line may rise before it reaches its tag (rupees, GST-inclusive),
 *  measured on its gross before the level discount — the same two figures the
 *  receipt's ladder compares. */
export function lineRoomIncl(l: UpliftLine): number {
    if (l.fixed || l.tagPaise == null || l.quantity <= 0 || l.rate <= 0) return 0;
    const gross = l.quantity * l.rate * (1 + l.taxRate / 100);
    return Math.max(0, (l.tagPaise / 100) * l.quantity - gross);
}

/**
 * The pre-tax unit rate each line posts at once `recovery` rupees are shared out
 * over the lines by their room (index-aligned with `lines`). Each rate is floored
 * to the paisa the voucher stores and never passes tag ÷ (1 + GST), so no line
 * ever prints above its tag. A line that does not move keeps its rate exactly.
 * Recovers less than asked when the bill runs out of room — the shop bears the rest.
 */
export function upliftedRates(lines: UpliftLine[], recovery: number): number[] {
    const rooms = lines.map(lineRoomIncl);
    const room = rooms.reduce((s, r) => s + r, 0);
    const take = Math.min(Math.max(0, recovery), room);
    if (take <= 0) return lines.map((l) => l.rate);
    return lines.map((l, i) => {
        if (rooms[i] <= 0) return l.rate;
        const gstFactor = 1 + l.taxRate / 100;
        const shareExcl = (take * rooms[i]) / room / gstFactor;
        const raised = floor2(l.rate + shareExcl / l.quantity);
        const ceiling = floor2(l.tagPaise! / 100 / gstFactor);
        const next = Math.min(raised, ceiling);
        return next > l.rate ? next : l.rate;
    });
}
