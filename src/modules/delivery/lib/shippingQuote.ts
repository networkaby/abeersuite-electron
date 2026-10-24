// SERVER-ONLY. Builds the courier options shown at checkout for a delivery
// pincode + parcel. Options come from every active DeliveryMethod:
//   SHIPROCKET → every serviceable courier from the API (cheapest-first, capped),
//                one option each (omitted when the pincode isn't serviceable or the
//                creds/pickup pincode are missing)
//   CUSTOM     → one option per active service level (its rate card)
//   OWN_BOY    → one option per vehicle that covers the neighbourhood + fits weight
//   STORE_PICKUP  → one ₹0 option (customer collects from the shop); optional serve
//                   list — empty = offered everywhere, non-empty = only where it matches
//   FREE_DELIVERY → one ₹0 option, ONLY where its serve list matches (empty = nowhere)
// The customer's pick becomes TicketOrder.shippingChargePaise + courier.

import {
    loadActiveDeliveryMethods,
    ownBoyRatePaise,
    ownBoyVehicles,
    ownBoyVehicleFits,
    computeCustomRatePaise,
    cheapestCustomRatePaise,
    isDestinationExcluded,
    destinationMatchesList,
    hasServeList,
    type CustomConfig,
    type DeliveryKind,
    type FreeDeliveryConfig,
    type OwnBoyConfig,
    type ShiprocketConfig,
    type ShipwayConfig,
    type StorePickupConfig,
} from "./deliveryMethods";
import { shiprocketServiceability, shiprocketEnvReady } from "./shiprocket";
import { shipwayServiceability, shipwayEnvReady } from "./shipway";

// How the merged aggregator pool (Shiprocket + Shipway) is curated at checkout — an
// N-slot arrangement (N = COURIER_SLOTS, any number ≥ 5). Display order top→bottom:
//   1        cheapest surface
//   2        priority surface — price contest: best-rank surface vs cheapest LISTED
//            non-surface (whichever is cheaper wins; India Post can't be the rival)
//   3 … n-2  fill — cheapest remaining, preference-list carriers first then outside;
//            no surface/non-surface distinction (India Post excluded)
//   n-1      cheapest non-surface (name without "surface")
//   n        best-preference non-surface
// So 2 surface slots at the top, 2 non-surface at the bottom, and (N-4) fills in the
// middle. Each DISTINCT service is its own courier (only the same service from both
// APIs collapses to the cheaper), so a carrier can appear more than once — its
// Surface, Express and Air are separate options and a used one never blocks another.
// Any courier priced below the lowest surface is economy → eligible for the surface
// quota too.
// Our own India Post is treated as surface and eligible ONLY in the surface quota
// (never premium/fill) when no aggregator offers India Post. The PREFERENCE list
// ranks carriers (first = highest); keys must match the courier name ("india post"
// ↔ "India Post"). Other Standard-courier services are a fallback (no preferred
// aggregator); the local boy always shows. When the pool is too small to fill all N
// slots, fewer are shown — never padded with duplicates.
const CARRIER_PREFERENCE = ["delhivery", "amazon", "xpressbees", "ekart", "ecom", "dtdc", "india post"];

// Total courier rows to display. Editable to any number ≥ 5 (2 surface + 2
// non-surface + at least one fill). Fewer show when the pool runs dry.
const COURIER_SLOTS = 6;

// HARD BLOCK LIST — couriers to NEVER show at checkout, whatever their price or
// rank. Each entry is matched (squashed, case-insensitive) against the aggregator
// courier name, so "bluedart" hides Bluedart, "air" hides every Air service, etc.
// Rejected couriers never enter the pool OR the dev-only hidden panel. Empty by
// default; add carriers/keywords here to suppress them everywhere.
const CARRIER_REJECT: string[] = [];

const squashLabel = (label: string) => label.toLowerCase().replace(/[^a-z]+/gu, "");

/** True when a courier name matches the reject list (dropped before curation). */
function isRejectedCourier(name: string): boolean {
    if (CARRIER_REJECT.length === 0) return false;
    const squashed = squashLabel(name);
    return CARRIER_REJECT.some((r) => {
        const key = squashLabel(r);
        return key.length > 0 && squashed.includes(key);
    });
}

/** The carrier a courier label belongs to (a preference key, or "other:<word>"). */
function carrierOf(label: string): string {
    const squashed = label.toLowerCase().replace(/[^a-z]+/gu, "");
    const hit = CARRIER_PREFERENCE.find((c) => squashed.includes(c.replace(/[^a-z]+/gu, "")));
    if (hit) return hit;
    return "other:" + (label.toLowerCase().replace(/\bshipway\b/gu, " ").trim().split(/\s+/u)[0] || squashed);
}

/** Preference rank of a carrier — lower is better; non-preferred sort last. */
function prefRank(carrier: string): number {
    const i = CARRIER_PREFERENCE.indexOf(carrier);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
}

/** "Surface" is the one reliable service label across aggregators. */
function isSurface(label: string): boolean {
    return /\bsurface\b/u.test(label.toLowerCase());
}

/** Tidy an aggregator courier label for display — drop the "Shipway" brand, the
 *  weight slab "(…kg)" and trailing weights, but KEEP the service word (Surface,
 *  Express…) since that's what the name actually says. */
function cleanLabel(label: string): string {
    return label
        .replace(/^\s*shipway\s+/iu, "")
        .replace(/\s*\([^)]*\)\s*/gu, " ")
        .replace(/\b\d+(\.\d+)?\s*(kgs?|gms?|g)\b/giu, " ")
        .replace(/\s+/gu, " ")
        .trim() || label;
}

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
    // Store pickup only — the store's pickup note (address / timings) shown to the
    // customer under the option when selected.
    pickupNote?: string;
    // Dev aid only — set on aggregator couriers dropped by the dedupe/cap, returned
    // (locally) so checkout can show them in a dev-only panel. Never set in prod.
    hidden?: boolean;
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
        } else if (m.kind === "STORE_PICKUP") {
            // Customer collects from the shop — always ₹0. Optional serve area:
            // EMPTY = offered everywhere (unlike free delivery); non-empty =
            // offered only where a served state / pincode prefix matches. The
            // pickup note (store address / timings) rides along for checkout.
            const cfg = m.configJson as StorePickupConfig;
            if (hasServeList(cfg.include) && !destinationMatchesList(cfg.include, params.deliveryPincode, params.deliveryState)) continue;
            out.push({
                optionId: `store_pickup:${m.id}`,
                methodId: m.id,
                kind: "STORE_PICKUP",
                label: m.displayName,
                amountPaise: 0,
                etaText: null,
                pickupNote: String(cfg.note ?? "").trim() || undefined,
            });
        } else if (m.kind === "FREE_DELIVERY") {
            // OUR free delivery — ₹0, ONLY where the serve list matches (state
            // listed OR pincode prefix). The common exclude already blocked pockets
            // above. Empty serve list matches nothing → offered nowhere.
            const cfg = m.configJson as FreeDeliveryConfig;
            if (!destinationMatchesList(cfg.include, params.deliveryPincode, params.deliveryState)) continue;
            out.push({
                optionId: `free_delivery:${m.id}`,
                methodId: m.id,
                kind: "FREE_DELIVERY",
                label: m.displayName,
                amountPaise: 0,
                etaText: null,
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
            // Push every Shiprocket courier — deduped vs Shipway and capped after the
            // merge (below). Each carries its courierId for fulfilment.
            for (const c of couriers) {
                if (isRejectedCourier(c.courierName)) continue;
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
            // Push every Shipway courier — deduped vs Shiprocket and capped after the
            // merge (below). courierId rides on the optionId for fulfilment.
            for (const c of couriers) {
                if (isRejectedCourier(c.courierName)) continue;
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

    // ── Curate the aggregator pool ────────────────────────────────────────────
    // Tag every Shiprocket/Shipway courier with its carrier, preference rank and
    // whether it's a surface service.
    type Agg = { o: ShippingOption; rank: number; surface: boolean };
    const aggAll: Agg[] = out
        .filter((o) => o.kind === "SHIPROCKET" || o.kind === "SHIPWAY")
        .map((o) => ({ o, rank: prefRank(carrierOf(o.label)), surface: isSurface(o.label) }));
    const byPrefPrice = (a: Agg, b: Agg) => a.rank - b.rank || a.o.amountPaise - b.o.amountPaise;

    // Treat our own INDIAN POST (a Standard-courier service) as a surface economy
    // option when NO aggregator offers India Post — so it competes in the list
    // instead of sitting only in the fallback.
    const pool: Agg[] = [...aggAll];
    const aggHasIndiaPost = aggAll.some((a) => carrierOf(a.o.label) === "india post");
    const customIndiaPost = aggHasIndiaPost
        ? undefined
        : out.find((o) => o.kind === "CUSTOM" && /indian?\s*post/iu.test(o.label));
    if (customIndiaPost) pool.push({ o: customIndiaPost, rank: prefRank("india post"), surface: true });

    // De-dup only TRUE duplicates: the SAME service offered by both APIs (Shiprocket
    // + Shipway) collapses to the cheaper. Different services of one carrier (Surface,
    // Express, Air, …) are DISTINCT couriers — each survives and a used one never
    // blocks another. The key is the cleaned service name (carrier + service word).
    const tierKey = (a: Agg) => cleanLabel(a.o.label).toLowerCase();
    const byKey = new Map<string, Agg>();
    for (const a of pool) {
        const cur = byKey.get(tierKey(a));
        if (!cur || a.o.amountPaise < cur.o.amountPaise) byKey.set(tierKey(a), a);
    }
    // Then drop NEAR-duplicates: same carrier + same tier priced within a whisker of
    // a cheaper survivor — e.g. "Xpressbees Express ₹169.20" and the plain "Xpressbees
    // ₹170.20" are effectively one courier. Distinct services with a real price gap
    // (Express ₹169 vs Air ₹618) are kept. Threshold: ₹20 or 5%, whichever is larger.
    const NEAR_DUP_PAISE = 2000;
    const NEAR_DUP_FRAC = 0.05;
    const dedup: Agg[] = [];
    for (const a of [...byKey.values()].sort((x, y) => x.o.amountPaise - y.o.amountPaise)) {
        const carrier = carrierOf(a.o.label);
        const nearCheaper = dedup.some(
            (k) =>
                carrierOf(k.o.label) === carrier &&
                k.surface === a.surface &&
                a.o.amountPaise - k.o.amountPaise <=
                Math.max(NEAR_DUP_PAISE, Math.round(k.o.amountPaise * NEAR_DUP_FRAC))
        );
        if (!nearCheaper) dedup.push(a);
    }

    // "Below the lowest surface" is economy → eligible for the surface quota too.
    const lowestSurface = Math.min(
        ...dedup.filter((a) => a.surface).map((a) => a.o.amountPaise),
        Number.POSITIVE_INFINITY
    );
    const belowLowest = (a: Agg) => Number.isFinite(lowestSurface) && a.o.amountPaise < lowestSurface;
    const isIndiaPost = (a: Agg) => carrierOf(a.o.label) === "india post";

    const surfaceEligible = dedup.filter((a) => a.surface || belowLowest(a));
    // India Post is eligible ONLY in the surface quota.
    const premiumEligible = dedup.filter((a) => !a.surface && !isIndiaPost(a));

    const usedIds = new Set<string>();
    const free = (a: Agg) => !usedIds.has(a.o.optionId);
    const pick = (a?: Agg): Agg | undefined => {
        if (a && free(a)) { usedIds.add(a.o.optionId); return a; }
        return undefined;
    };
    const cheapest = (l: Agg[]) => [...l].sort((a, b) => a.o.amountPaise - b.o.amountPaise);
    const preferred = (l: Agg[]) => [...l].sort(byPrefPrice);

    // ── Anchors: 2 surface at the top, 2 non-surface at the bottom ────────────
    // No carrier blocking between anchors (a carrier's Surface and Express can both
    // appear); only exact-option de-dup. All four are claimed BEFORE the fills, so
    // the fills compete over whatever is left.

    // 1. cheapest surface-eligible.
    const sTop = pick(cheapest(surfaceEligible).find(free));

    // 2. priority surface — a price contest, cheaper wins, between the best-rank
    //    surface and the cheapest LISTED non-surface (India Post can't be the rival;
    //    its priority index is ignored — only "in list" + cheapest). The loser stays
    //    free for the non-surface anchors below.
    const surfaceChampion = preferred(dedup.filter((a) => a.surface)).find(free);
    const nonSurfaceRival = cheapest(
        dedup.filter((a) => !a.surface && !isIndiaPost(a) && Number.isFinite(a.rank))
    ).find(free);
    const sPriority = pick(
        [surfaceChampion, nonSurfaceRival]
            .filter((a): a is Agg => !!a)
            .sort((a, b) => a.o.amountPaise - b.o.amountPaise)[0]
    );

    // n-1. cheapest non-surface.   n. best-preference non-surface.
    const nsCheap = pick(cheapest(premiumEligible).find(free));
    const nsPriority = pick(preferred(premiumEligible).find(free));

    // ── Fills (slots 3 … n-2) ─────────────────────────────────────────────────
    // Cheapest remaining, preference-list carriers first then outside; no surface /
    // non-surface distinction; never India Post. Take up to (N-4) — fewer if the
    // pool runs dry, never padded.
    const fillSorted = dedup
        .filter((a) => !isIndiaPost(a))
        .sort((a, b) => (Number.isFinite(a.rank) ? 0 : 1) - (Number.isFinite(b.rank) ? 0 : 1) || a.o.amountPaise - b.o.amountPaise);
    const fillCount = Math.max(0, COURIER_SLOTS - 4);
    const fills: Agg[] = [];
    for (const a of fillSorted) {
        if (fills.length >= fillCount) break;
        const got = pick(a);
        if (got) fills.push(got);
    }

    // Display order: 2 surface, the fills, 2 non-surface (drop empty slots); tidy labels.
    const chosenAgg = [sTop, sPriority, ...fills, nsCheap, nsPriority].filter((a): a is Agg => !!a);
    const aggOpts = chosenAgg.map((a): ShippingOption => ({ ...a.o, label: cleanLabel(a.o.label) }));

    // Local boy always shows. Standard-courier services (except India Post, handled
    // above via the surface quota) stay a FALLBACK — shown only when no preferred
    // AGGREGATOR courier is available.
    const hasPreferredAgg = chosenAgg.some(
        (a) => Number.isFinite(a.rank) && (a.o.kind === "SHIPROCKET" || a.o.kind === "SHIPWAY")
    );
    const indiaPostId = customIndiaPost?.optionId;
    // Store pickup + free delivery always show when quoted (both ₹0 — the price
    // sort puts them on top). They never join the aggregator curation.
    const ownLocal = out.filter((o) => o.kind === "OWN_BOY" || o.kind === "STORE_PICKUP" || o.kind === "FREE_DELIVERY");
    const ownStandard = hasPreferredAgg
        ? []
        : out.filter((o) => o.kind === "CUSTOM" && !usedIds.has(o.optionId) && o.optionId !== indiaPostId);
    // The SELECTION above decides WHICH couriers show; the DISPLAY is then sorted by
    // price (cheapest first) so the list reads cleanly — the slot arrangement no
    // longer dictates on-screen order.
    const shown = [...ownLocal, ...ownStandard, ...aggOpts].sort((a, b) => a.amountPaise - b.amountPaise);

    // Dev aid: on the dev server also return the couriers that were dropped, flagged
    // `hidden`, so checkout can list them in a dev-only panel. Production returns
    // only the clean `shown` list.
    const devPreview = process.env.NODE_ENV !== "production";
    if (!devPreview) return shown;
    const shownIds = new Set(shown.map((o) => o.optionId));
    const hidden = out
        .filter((o) => !shownIds.has(o.optionId))
        .map((o): ShippingOption => ({ ...o, hidden: true }))
        .sort((a, b) => a.amountPaise - b.amountPaise);
    return [...shown, ...hidden];
}
