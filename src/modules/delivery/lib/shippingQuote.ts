// SERVER-ONLY. Builds the courier options shown at checkout for a delivery
// pincode + parcel. One option per active DeliveryMethod:
//   SHIPROCKET → live cheapest rate from the serviceability API (omitted when the
//                pincode isn't serviceable or the creds/pickup pincode are missing)
//   CUSTOM     → the admin's flat rate (free above an optional threshold)
//   OWN_BOY    → same, but only when the pincode is in the serviceable list
// The customer's pick becomes TicketOrder.shippingChargePaise + courier.

import {
    loadActiveDeliveryMethods,
    ownBoyServes,
    type CustomConfig,
    type DeliveryKind,
    type OwnBoyConfig,
    type ShiprocketConfig,
} from "./deliveryMethods";
import { shiprocketCheapest, shiprocketEnvReady } from "./shiprocket";

export type ShippingOption = {
    methodId: number;
    kind: DeliveryKind;
    label: string;
    amountPaise: number;
    etaText: string | null;
    // Shiprocket only — the chosen courier the fulfilment step will assign.
    shiprocketCourierId?: number;
    shiprocketCourierName?: string;
};

function flatWithFreeAbove(
    cfg: { flatPaise?: number; freeAbovePaise?: number },
    subtotalPaise: number
): number {
    const flat = Math.max(0, Math.round(cfg.flatPaise ?? 0));
    const freeAbove = cfg.freeAbovePaise ?? 0;
    if (freeAbove > 0 && subtotalPaise >= freeAbove) return 0;
    return flat;
}

export async function quoteShipping(params: {
    deliveryPincode: string;
    subtotalPaise: number;
    weightGrams: number;
    cod: boolean;
}): Promise<ShippingOption[]> {
    const methods = await loadActiveDeliveryMethods();
    const out: ShippingOption[] = [];

    for (const m of methods) {
        if (m.kind === "CUSTOM") {
            const cfg = m.configJson as CustomConfig;
            out.push({
                methodId: m.id,
                kind: "CUSTOM",
                label: m.displayName,
                amountPaise: flatWithFreeAbove(cfg, params.subtotalPaise),
                etaText: null,
            });
        } else if (m.kind === "OWN_BOY") {
            const cfg = m.configJson as OwnBoyConfig;
            if (!ownBoyServes(cfg, params.deliveryPincode)) continue;
            out.push({
                methodId: m.id,
                kind: "OWN_BOY",
                label: m.displayName,
                amountPaise: flatWithFreeAbove(cfg, params.subtotalPaise),
                etaText: null,
            });
        } else if (m.kind === "SHIPROCKET") {
            const cfg = m.configJson as ShiprocketConfig;
            if (!shiprocketEnvReady() || !cfg.pickupPincode) continue;
            const cheapest = await shiprocketCheapest({
                pickupPincode: String(cfg.pickupPincode),
                deliveryPincode: params.deliveryPincode,
                weightGrams: params.weightGrams,
                cod: params.cod,
            });
            if (!cheapest) continue;
            out.push({
                methodId: m.id,
                kind: "SHIPROCKET",
                label: `${m.displayName} · ${cheapest.courierName}`,
                amountPaise: cheapest.ratePaise,
                etaText: cheapest.etaText ?? (cheapest.etaDays ? `${cheapest.etaDays} days` : null),
                shiprocketCourierId: cheapest.courierId,
                shiprocketCourierName: cheapest.courierName,
            });
        }
    }
    return out;
}
