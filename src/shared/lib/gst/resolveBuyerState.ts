/**
 * Decides what state code to use as the "buyer state" (place of supply)
 * when posting a voucher's tax. The decision depends on the voucher's
 * delivery mode (set by the cashier on the voucher form, or hard-coded to
 * COUNTER for POS sales).
 *
 * Pure — no Prisma. Used by both the API (server-side) and the voucher
 * form (live preview badge).
 *
 * COUNTER (customer takes goods at the counter — no delivery):
 *   1. GSTIN-derived state — preserves B2B inter-state ITC even if the
 *      registered buyer walked in to collect themselves.
 *   2. Branch state — walk-in B2C, no GSTIN. We intentionally IGNORE the
 *      customer's stored shippingStateCode here: an over-the-counter sale's
 *      place of supply is the supplier's counter (§10(1)(c)), not the
 *      customer's home address.
 *
 * SHIPPED (goods couriered / dispatched to the customer):
 *   1. GSTIN-derived state — B2B always honours GSTIN.
 *   2. Customer's shippingStateCode — B2C destination.
 *   3. Branch state — defensive fallback when SHIPPED has no destination.
 */

import { gstinDerivedStateCode } from "@/shared/lib/gst/computeGstSplit";

export type DeliveryMode = "COUNTER" | "SHIPPED";

export type ResolvableParty = {
    gstin?:             string | null;
    gstStateCode?:      string | null;  // mirrors gstin[:2] when gstin is set
    shippingStateCode?: string | null;  // admin-picked default for B2C couriered sales
};

export function resolveBuyerStateCode(
    party:           ResolvableParty | null | undefined,
    sellerStateCode: string,
    deliveryMode:    DeliveryMode,
): string {
    const seller = (sellerStateCode || "").trim();

    if (party) {
        const fromGstin =
            gstinDerivedStateCode(party.gstin)
            // Honour an explicit gstStateCode too, in case a row exists with
            // gstStateCode set but the gstin field was cleared somehow.
            || (party.gstStateCode || "").trim();
        if (fromGstin) return fromGstin;

        if (deliveryMode === "SHIPPED" && party.shippingStateCode) {
            return party.shippingStateCode.trim();
        }
    }

    return seller;
}
