// SERVER-ONLY. Builds the courier options shown at checkout for a delivery
// pincode + parcel. Options come from every active DeliveryMethod:
//   SHIPROCKET → every serviceable courier from the API (cheapest-first, capped),
//                one option each (omitted when the pincode isn't serviceable or the
//                creds/pickup pincode are missing)
//   CUSTOM     → one option per active service level (its rate card)
//   OWN_BOY    → one option per vehicle that covers the neighbourhood + fits weight
// The customer's pick becomes TicketOrder.shippingChargePaise + courier.

import {
    loadActiveDeliveryMethods,
    ownBoyRatePaise,
    ownBoyVehicles,
    ownBoyVehicleFits,
    computeCustomRatePaise,
    cheapestCustomRatePaise,
    isDestinationExcluded,
    type CustomConfig,
    type DeliveryKind,
    type OwnBoyConfig,
    type ShiprocketConfig,
    type ShipwayConfig,
} from "./deliveryMethods";
import { shiprocketServiceability, shiprocketEnvReady } from "./shiprocket";
import { shipwayServiceability, shipwayEnvReady } from "./shipway";

// Cap on how many couriers each aggregator (Shiprocket / Shipway) surfaces at
// checkout — a serviceability call can return 15-25 couriers; showing the cheapest
// handful per aggregator keeps the picker usable. Shown cheapest-first.
const MAX_AGGREGATOR_OPTIONS = 8;

export type ShippingOption = {
    // Stable, unique per option — the value checkout sends back to identify the
    // pick (several options can share one methodId, e.g. each Standard-courier
    // service level, or each Shiprocket courier).
    optionId: string;
    methodId: number;
    kind: DeliveryKind;
    // For a Standard-courier service level, the service (= courier) name; the
    // label shown at checkout is this on its own — the container is not named.
    serviceName?: string;
    label: string;
    amountPaise: number;
    etaText: string | null;
    // Shiprocket only — the chosen courier the fulfilment step will assign.
    shiprocketCourierId?: number;
    shiprocketCourierName?: string;
};

/**
 * A destination-independent "from ₹X" shipping estimate for the cart page, before
 * an address is known. Walks couriers in PRIORITY order (sortOrder) and returns the
 * cheapest service of the highest-priority priceable courier — so the cart shows
 * the "priority" courier's rate. Only Standard-courier services can be priced
 * without a destination; the local boy needs a neighbourhood and Shiprocket a
 * pincode, so both are resolved at checkout. Null when nothing can be priced yet.
 */
export async function estimateCartShipping(params: {
    subtotalPaise: number;
    weightGrams: number;
}): Promise<{ fromPaise: number; courierName: string } | null> {
    const methods = await loadActiveDeliveryMethods(); // sortOrder asc = priority
    for (const m of methods) {
        if (m.kind !== "CUSTOM") continue;
        const cfg = m.configJson as CustomConfig;
        const services = Array.isArray(cfg.services) ? cfg.services.filter((s) => s.isActive !== false) : [];
        let best: { fromPaise: number; courierName: string } | null = null;
        const consider = (paise: number | null, name: string) => {
            if (paise == null) return;
            if (!best || paise < best.fromPaise) best = { fromPaise: paise, courierName: name };
        };
        if (services.length > 0) {
            for (const svc of services) consider(cheapestCustomRatePaise(svc, params), svc.name);
        } else {
            consider(cheapestCustomRatePaise(cfg, params), m.displayName);
        }
        if (best) return best; // highest-priority priceable courier wins
    }
    return null;
}

export async function quoteShipping(params: {
    deliveryPincode: string;
    deliveryState?: string;
    deliveryNeighbourhood?: string;
    subtotalPaise: number;
    weightGrams: number;
    cod: boolean;
}): Promise<ShippingOption[]> {
    const methods = await loadActiveDeliveryMethods();
    const out: ShippingOption[] = [];

    for (const m of methods) {
        // Availability exclusions — this courier isn't offered to the excluded
        // states / pincode prefixes, whatever its kind.
        if (isDestinationExcluded(m.configJson.exclude, params.deliveryPincode, params.deliveryState)) continue;

        if (m.kind === "CUSTOM") {
            const cfg = m.configJson as CustomConfig;
            const rateParams = {
                weightGrams: params.weightGrams,
                subtotalPaise: params.subtotalPaise,
                deliveryPincode: params.deliveryPincode,
                deliveryState: params.deliveryState,
                cod: params.cod,
            };
            // Each active service level IS a courier — one checkout option per
            // service, named by the service itself. A null price = ZONE mode with
            // no zone serving this destination → that service is simply omitted.
            const services = Array.isArray(cfg.services) ? cfg.services : [];
            const active = services.filter((s) => s.isActive !== false);
            if (active.length > 0) {
                active.forEach((svc, idx) => {
                    const amountPaise = computeCustomRatePaise(svc, rateParams);
                    if (amountPaise == null) return;
                    out.push({
                        optionId: `custom:${m.id}:${idx}`,
                        methodId: m.id,
                        kind: "CUSTOM",
                        serviceName: svc.name,
                        label: svc.name,
                        amountPaise,
                        etaText: null,
                    });
                });
            } else {
                // Legacy single base card (no service levels yet).
                const amountPaise = computeCustomRatePaise(cfg, rateParams);
                if (amountPaise != null) {
                    out.push({
                        optionId: `custom:${m.id}`,
                        methodId: m.id,
                        kind: "CUSTOM",
                        label: m.displayName,
                        amountPaise,
                        etaText: null,
                    });
                }
            }
        } else if (m.kind === "OWN_BOY") {
            const cfg = m.configJson as OwnBoyConfig;
            // Each vehicle (Bike / Car / …) IS its own local courier — one checkout
            // option per active vehicle that (a) fits the parcel weight and (b) covers
            // the picked neighbourhood (ladder: neighbourhood → locality). No flat /
            // whole-pincode fallback: a null rate → that vehicle is omitted.
            ownBoyVehicles(cfg).forEach((v, idx) => {
                if (v.isActive === false) return;
                if (!ownBoyVehicleFits(v, params.weightGrams)) return; // over this vehicle's limit
                const amountPaise = ownBoyRatePaise(v, {
                    weightGrams: params.weightGrams,
                    subtotalPaise: params.subtotalPaise,
                    pincode: params.deliveryPincode,
                    neighbourhood: params.deliveryNeighbourhood,
                });
                if (amountPaise == null) return; // not covered by this vehicle
                out.push({
                    optionId: `own_boy:${m.id}:${idx}`,
                    methodId: m.id,
                    kind: "OWN_BOY",
                    serviceName: v.name,
                    label: v.name,
                    amountPaise,
                    etaText: null,
                });
            });
        } else if (m.kind === "SHIPROCKET") {
            const cfg = m.configJson as ShiprocketConfig;
            if (!shiprocketEnvReady() || !cfg.pickupPincode) continue;
            const couriers = await shiprocketServiceability({
                pickupPincode: String(cfg.pickupPincode),
                deliveryPincode: params.deliveryPincode,
                weightGrams: params.weightGrams,
                cod: params.cod,
            });
            // One option per Shiprocket courier — cheapest-first, capped so the
            // picker isn't flooded. Each carries its courierId for fulfilment.
            const shown = [...couriers]
                .sort((a, b) => a.ratePaise - b.ratePaise)
                .slice(0, MAX_AGGREGATOR_OPTIONS);
            for (const c of shown) {
                out.push({
                    optionId: `shiprocket:${m.id}:${c.courierId}`,
                    methodId: m.id,
                    kind: "SHIPROCKET",
                    serviceName: c.courierName,
                    label: c.courierName,
                    amountPaise: c.ratePaise,
                    etaText: c.etaText ?? (c.etaDays ? `${c.etaDays} days` : null),
                    shiprocketCourierId: c.courierId,
                    shiprocketCourierName: c.courierName,
                });
            }
        } else if (m.kind === "SHIPWAY") {
            const cfg = m.configJson as ShipwayConfig;
            if (!shipwayEnvReady() || !cfg.pickupPincode) continue;
            const couriers = await shipwayServiceability({
                pickupPincode: String(cfg.pickupPincode),
                deliveryPincode: params.deliveryPincode,
                weightGrams: params.weightGrams,
                cod: params.cod,
            });
            // One option per Shipway courier — cheapest-first, capped. courierId
            // rides on the optionId for the (later) fulfilment step.
            const shown = [...couriers]
                .sort((a, b) => a.ratePaise - b.ratePaise)
                .slice(0, MAX_AGGREGATOR_OPTIONS);
            for (const c of shown) {
                out.push({
                    optionId: `shipway:${m.id}:${c.courierId}`,
                    methodId: m.id,
                    kind: "SHIPWAY",
                    serviceName: c.courierName,
                    label: c.courierName,
                    amountPaise: c.ratePaise,
                    etaText: c.etaText ?? (c.etaDays ? `${c.etaDays} days` : null),
                });
            }
        }
    }
    return out;
}
