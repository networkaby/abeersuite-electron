// Pure, client-safe delivery-method vocabulary + config helpers. NO prisma / no
// server-only imports, so both the Settings → Couriers client page and the
// server-side loaders (deliveryMethods.ts) can import from here without dragging
// the DB client into a client bundle.

import { INDIAN_STATES } from "@/shared/lib/gst/indianStates";

export type DeliveryKind = "SHIPROCKET" | "SHIPWAY" | "CUSTOM" | "OWN_BOY" | "STORE_PICKUP" | "FREE_DELIVERY";

// Canonical India state names (reused from the GST module) — the values a zone
// can be matched by, and what the checkout state picker offers.
export const INDIA_STATE_NAMES: string[] = INDIAN_STATES.filter((s) => Number(s.code) < 97).map((s) => s.name);
const STATE_CANONICAL = new Map(INDIAN_STATES.map((s) => [s.name.toLowerCase(), s.name]));
/** Normalise a free-text/selected state to its canonical name, or null. */
export function canonicalStateName(name: string | null | undefined): string | null {
    return name ? STATE_CANONICAL.get(name.trim().toLowerCase()) ?? null : null;
}

/**
 * "Quick" = the option commits delivery today or tomorrow (owner, 2026-11-22). A cart
 * with any item short of stock (backorder) is never offered a quick option — we
 * cannot promise a day for something we still have to procure. Stored as
 * `configJson.quick`; unset falls back to the kind's default (delivery boy and
 * store pickup are quick).
 */
export const QUICK_BY_DEFAULT: DeliveryKind[] = ["OWN_BOY", "STORE_PICKUP"];
export function isQuickMethod(kind: DeliveryKind, configJson: unknown): boolean {
    const q = (configJson as { quick?: unknown } | null)?.quick;
    return typeof q === "boolean" ? q : QUICK_BY_DEFAULT.includes(kind);
}

export const DELIVERY_KINDS: DeliveryKind[] = ["OWN_BOY", "CUSTOM", "SHIPROCKET", "SHIPWAY", "STORE_PICKUP", "FREE_DELIVERY"];

export const DELIVERY_KIND_LABEL: Record<DeliveryKind, string> = {
    OWN_BOY: "Local delivery boy",
    // "Standard courier" = OUR own courier service (renamed from "Custom courier";
    // the CUSTOM kind id stays for row/data stability).
    CUSTOM: "Standard courier",
    SHIPROCKET: "Shiprocket",
    SHIPWAY: "Shipway",
    // Customer collects the order from our shop — always ₹0, no courier involved.
    STORE_PICKUP: "Pickup from store",
    // OUR free delivery — ₹0, offered ONLY inside its serve list (states/pincode
    // prefixes); empty serve list = offered nowhere.
    FREE_DELIVERY: "Free delivery",
};

/**
 * The HARD-CODED courier catalog — the six delivery options are fixed in code, not
 * user-addable/deletable. The DB stores only each courier's editable CONFIG
 * (exclusions, pickup, active, priority, service levels, vehicles). A seventh option
 * is added by extending this list (and DELIVERY_KINDS) in code — never via the UI.
 *
 * These are create-if-absent defaults: the app ensures one row per kind exists (so a
 * fresh DB needs no seed), and never clobbers an admin's saved config. Single source
 * for both the app's ensure-on-load and the seed applier.
 */
export const DELIVERY_METHOD_DEFAULTS: {
    kind: DeliveryKind;
    displayName: string;
    isActive: boolean;
    sortOrder: number;
    configJson: Record<string, unknown>;
}[] = [
    { kind: "OWN_BOY", displayName: "Local delivery", isActive: true, sortOrder: 0, configJson: { pincodes: [], flatPaise: 4900, freeAbovePaise: 0, baseGrams: 500, stepGrams: 500, neighbourhoods: {} } },
    { kind: "CUSTOM", displayName: "Standard courier", isActive: true, sortOrder: 1, configJson: { flatPaise: 9900, freeAbovePaise: 500000 } },
    { kind: "SHIPROCKET", displayName: "Shiprocket", isActive: false, sortOrder: 2, configJson: { pickupLocation: "Primary", pickupPincode: "", defaultItemWeightGrams: 500 } },
    { kind: "SHIPWAY", displayName: "Shipway", isActive: false, sortOrder: 3, configJson: { pickupLocation: "Primary", pickupPincode: "", defaultItemWeightGrams: 500 } },
    { kind: "STORE_PICKUP", displayName: "Pickup from store", isActive: true, sortOrder: 4, configJson: { note: "", include: { states: [], pincodePrefixes: [] } } },
    // Inactive with an empty serve list on purpose — admin must switch it on AND
    // set coverage first (empty serve list = offered nowhere, never all-India free).
    { kind: "FREE_DELIVERY", displayName: "Free delivery", isActive: false, sortOrder: 5, configJson: { include: { states: [], pincodePrefixes: [] } } },
];

/** Aggregator (Shiprocket / Shipway): no stored rate — priced live by the API.
 *  Only non-secret pickup config lives here; API creds come from env. */
export type ShiprocketConfig = {
    pickupLocation?: string; // registered pickup nickname in the Shiprocket panel
    pickupPincode?: string; // origin postcode for serviceability + rate
    defaultItemWeightGrams?: number; // fallback per unit when a product has no weight
    length?: number; // parcel dims (cm) sent to the API
    breadth?: number;
    height?: number;
};

/** Shipway pickup config — same shape as Shiprocket's (an aggregator rate source). */
export type ShipwayConfig = ShiprocketConfig;

/** Pickup from store — always ₹0. The note (store address / timings) is shown to
 *  the customer at checkout under the option. Optional serve area (`include`):
 *  EMPTY = offered everywhere (pickup costs nothing — opposite of free delivery's
 *  empty-means-nowhere); non-empty = offered only where it matches. */
export type StorePickupConfig = {
    note?: string;
    include?: DeliveryExclusions; // same {states, pincodePrefixes} shape as exclude
};

/** Free delivery — ₹0, offered ONLY where the serve list (`include`) matches:
 *  destination state listed, OR pincode starts with a listed prefix. The common
 *  `exclude` then blocks pockets inside a served area (e.g. serve Assam, block
 *  7844…). Empty serve list = offered nowhere. */
export type FreeDeliveryConfig = {
    include?: DeliveryExclusions; // same {states, pincodePrefixes} shape as exclude
};

/** The aggregator kinds priced live by an external API (vs our own rate cards). */
export const AGGREGATOR_KINDS: DeliveryKind[] = ["SHIPROCKET", "SHIPWAY"];

// ── Standard courier rate card ────────────────────────────────────────────
// OUR own courier — the only one priced by a manually-built rate card (other
// couriers get their rate from their API). It reads like a real courier tariff:
//   FLAT – one price for any parcel.
//   ZONE – a zone × weight matrix. Named zones (Within City, Within State, Metro
//          to Metro, Rest of India, North East & J&K) matched by destination
//          pincode prefix; per zone a BASE rate (first slab) + ADDITIONAL rate
//          (each extra slab). Slab weights (first / additional) are shared across
//          zones, exactly like a courier rate sheet. Plus a COD surcharge
//          (flat + % of order value) applied when the order is cash-on-delivery.

export type CustomRateMode = "FLAT" | "ZONE";

/**
 * One zone row of the matrix: matched by pincode prefix, base + additional FORWARD
 * rate, plus the matching RTO (return-to-origin) rate — every real courier rate
 * card (Shiprocket, Shipway, India Post) quotes both per zone. RTO is charged when
 * a shipment fails delivery and returns to us; it's decision-support on the
 * delivery record, not part of the checkout charge.
 */
export type ZoneRate = {
    name: string;
    /** Destination pincode prefixes this zone covers (e.g. ["11","12"]). */
    pincodePrefixes: string[];
    /** Canonical India state names this zone covers (matched when no prefix hits). */
    states?: string[];
    /** Catch-all zone used when nothing else matches (e.g. "Rest of India"). */
    isDefault?: boolean;
    basePaise: number; // forward: first slab
    addlPaise: number; // forward: each additional slab
    rtoBasePaise?: number; // RTO: first slab (defaults to basePaise when unset)
    rtoAddlPaise?: number; // RTO: each additional slab (defaults to addlPaise when unset)
};

/** One rate card: how a parcel is priced (used standalone and per service level). */
export type RateCard = {
    mode?: CustomRateMode; // default FLAT (back-compat with old {flatPaise} rows)
    freeAbovePaise?: number; // subtotal at/above which the forward charge is free
    // COD surcharge — added when the order is cash-on-delivery.
    codFlatPaise?: number; // flat COD handling fee
    codPercent?: number; // % of order value (e.g. 1.7)
    flatPaise?: number; // FLAT mode
    // ZONE mode — shared slab weights + the zone matrix.
    baseGrams?: number; // first slab weight (e.g. 500)
    stepGrams?: number; // each additional step (e.g. 500)
    zones?: ZoneRate[];
};

/** A Standard-courier service level (Premium / Ordinary / …) — its own rate card. */
export type CustomServiceLevel = RateCard & {
    name: string;
    isActive?: boolean;
};

export type CustomConfig = RateCard & {
    /**
     * Service levels of OUR courier (Premium / Ordinary / …), each with its own
     * rate card. When present + active they are what checkout should offer
     * (one option per level); the top-level card stays as the legacy/simple
     * single-rate fallback. Checkout wiring for levels is a follow-up.
     */
    services?: CustomServiceLevel[];
};

/** In-house delivery boy: offered only for the listed pincodes. */
// Local delivery boy coverage. Three levels: PINCODE → LOCALITY → NEIGHBOURHOOD.
// The pincode is the enabler; under it we list the localities (India Post areas)
// we serve, and under each locality the specific neighbourhoods our boy covers.
// A neighbourhood belongs to exactly one locality. `pincodes[]` is the legacy
// whole-pincode list, kept working alongside the finer neighbourhood map.
//
// PRICING — a neighbourhood × weight matrix, priced by the SAME weight-slab engine
// as the Standard courier (shared `baseGrams`/`stepGrams`, per-row base + additional).
// The rate is resolved by a ladder, most specific first:
//   neighbourhood rate → locality rate → NOT SERVICEABLE.
// So a whole locality can be priced once, overriding only the odd near/far
// neighbourhood. There is NO flat fallback: a neighbourhood with no rate (its own
// or its locality's) is simply not offered local delivery. `freeAbovePaise` zeroes
// a resolved rate over a subtotal.

/** One covered neighbourhood — optional own rate (falls back to locality/flat). */
export type OwnBoyNeighbourhood = {
    name: string;
    basePaise?: number; // first slab; unset (or 0) → use the locality/flat rate
    addlPaise?: number; // each additional slab; unset → same as basePaise
};

/** One covered locality (India Post area) — optional own rate + its neighbourhoods. */
export type OwnBoyLocality = {
    basePaise?: number; // first slab; unset (or 0) → use the flat rate
    addlPaise?: number; // each additional slab; unset → same as basePaise
    neighbourhoods: OwnBoyNeighbourhood[];
};

/** The rate-bearing part of a local courier: coverage + slab weights + free-above. */
export type OwnBoyMatrix = {
    freeAbovePaise?: number;
    baseGrams?: number; // first-slab weight (default 500)
    stepGrams?: number; // additional-slab weight (default 500)
    // pincode → { locality name → locality (rate + neighbourhoods) }.
    // Legacy shape (locality → [name strings]) is still read transparently.
    neighbourhoods?: Record<string, Record<string, OwnBoyLocality>>;
};

/**
 * One local courier — a vehicle (Bike / Car / …). Each is its own courier at
 * checkout, exactly like a Standard-courier service level: its own rate matrix,
 * its own coverage, plus a weight limit (a parcel over the limit isn't offered
 * that vehicle).
 */
export type OwnBoyVehicle = OwnBoyMatrix & {
    name: string;
    isActive?: boolean;
    maxWeightGrams?: number; // parcel over this → vehicle not offered (0/undef = no cap)
};

export type OwnBoyConfig = OwnBoyMatrix & {
    pincodes?: string[]; // legacy: whole-pincode serviceability
    flatPaise?: number; // legacy/inert (no flat fallback)
    // Local couriers (vehicles). When present they ARE what checkout offers — one
    // option per active vehicle. Absent → the top-level matrix acts as ONE implicit
    // vehicle (back-compat with the pre-vehicle single-matrix config).
    vehicles?: OwnBoyVehicle[];
};

export type DeliveryMethodRow = {
    id: number;
    kind: DeliveryKind;
    displayName: string;
    isActive: boolean;
    sortOrder: number;
    configJson: Record<string, unknown>;
};

/**
 * Per-courier availability exclusions — destinations this courier is NOT offered.
 * Common to every kind, stored on `configJson.exclude`. A destination matches when
 * its state is listed, or its pincode starts with a listed prefix.
 */
export type DeliveryExclusions = {
    states?: string[]; // canonical India state names
    pincodePrefixes?: string[]; // destination pincode prefixes (e.g. "78", "781301")
};

/** Clean operator-entered exclusions (canonical states + numeric pincode prefixes). */
export function sanitizeExclusions(raw: unknown): DeliveryExclusions {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const states = Array.isArray(r.states)
        ? [...new Set(r.states.map((s) => canonicalStateName(String(s))).filter((s): s is string => !!s))]
        : [];
    const pincodePrefixes = Array.isArray(r.pincodePrefixes)
        ? [...new Set(r.pincodePrefixes.map((p) => String(p).trim()).filter((p) => /^\d{1,6}$/u.test(p)))]
        : [];
    return { states, pincodePrefixes };
}

/** Does a destination match a {states, pincodePrefixes} list? (state listed OR
 *  pincode starts with a listed prefix). Shared by exclude AND the free-delivery
 *  serve list — same matching, opposite meaning. */
export function destinationMatchesList(list: unknown, pincode: string, state?: string | null): boolean {
    const e = (list && typeof list === "object" ? list : {}) as DeliveryExclusions;
    const st = canonicalStateName(state ?? "");
    if (st && Array.isArray(e.states) && e.states.some((s) => canonicalStateName(s) === st)) return true;
    const p = pincode.trim();
    if (Array.isArray(e.pincodePrefixes) && e.pincodePrefixes.some((pre) => {
        const x = String(pre).trim();
        return !!x && p.startsWith(x);
    })) return true;
    return false;
}

/** True when a destination is on a courier's exclusion list (state OR pincode prefix). */
export function isDestinationExcluded(exclude: unknown, pincode: string, state?: string | null): boolean {
    return destinationMatchesList(exclude, pincode, state);
}

/** Does a serve list have any entries? (Decides the empty-list meaning per kind:
 *  free delivery empty = nowhere; store pickup empty = everywhere.) */
export function hasServeList(list: DeliveryExclusions | undefined): boolean {
    return (list?.states?.length ?? 0) > 0 || (list?.pincodePrefixes?.length ?? 0) > 0;
}

const intOrZero = (v: unknown): number => Math.max(0, Math.round(Number(v) || 0));

// ── Local-delivery neighbourhood coverage (pincode → locality → neighbourhood) ─

type NbMap = Record<string, Record<string, OwnBoyLocality>>;
const nbMap = (cfg: OwnBoyMatrix): Record<string, unknown> =>
    cfg.neighbourhoods && typeof cfg.neighbourhoods === "object" ? (cfg.neighbourhoods as Record<string, unknown>) : {};

const posInt = (v: unknown): number | undefined => {
    const n = Math.round(Number(v) || 0);
    return n > 0 ? n : undefined;
};

/** Normalise one locality leaf — accepts both the legacy `string[]` (names only)
 *  and the new `{ basePaise?, addlPaise?, neighbourhoods: [...] }` object. */
function normLocality(raw: unknown): OwnBoyLocality {
    if (Array.isArray(raw)) {
        return {
            neighbourhoods: raw
                .map((n) => ({ name: String(n).trim() }))
                .filter((n) => n.name),
        };
    }
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const ns = Array.isArray(r.neighbourhoods) ? r.neighbourhoods : [];
    return {
        basePaise: posInt(r.basePaise),
        addlPaise: posInt(r.addlPaise),
        neighbourhoods: ns
            .map((n) => {
                if (typeof n === "string") return { name: n.trim() };
                const o = (n && typeof n === "object" ? n : {}) as Record<string, unknown>;
                return { name: String(o.name ?? "").trim(), basePaise: posInt(o.basePaise), addlPaise: posInt(o.addlPaise) };
            })
            .filter((n) => n.name),
    };
}

/** All localities under a pincode, normalised (rate + neighbourhoods). */
export function ownBoyPincodeLocalities(cfg: OwnBoyMatrix, pincode: string): Record<string, OwnBoyLocality> {
    const raw = nbMap(cfg)[pincode.trim()];
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, OwnBoyLocality> = {};
    for (const [loc, rawLoc] of Object.entries(raw as Record<string, unknown>)) {
        const locName = String(loc).trim();
        const norm = normLocality(rawLoc);
        if (locName && norm.neighbourhoods.length > 0) out[locName] = norm;
    }
    return out;
}

/** The parent locality of a covered neighbourhood (for the auto-select). */
export function ownBoyLocalityOf(cfg: OwnBoyMatrix, pincode: string, neighbourhood: string): string | null {
    const byLoc = ownBoyPincodeLocalities(cfg, pincode);
    const nb = neighbourhood.trim();
    return Object.keys(byLoc).find((l) => byLoc[l].neighbourhoods.some((n) => n.name === nb)) ?? null;
}

/**
 * The local couriers (vehicles). When `vehicles` is set they ARE the list; else a
 * single implicit vehicle is synthesised from the top-level matrix so the legacy
 * single-matrix config keeps working unchanged.
 */
export function ownBoyVehicles(cfg: OwnBoyConfig): OwnBoyVehicle[] {
    if (Array.isArray(cfg.vehicles) && cfg.vehicles.length > 0) return cfg.vehicles;
    if (cfg.neighbourhoods && Object.keys(cfg.neighbourhoods).length > 0) {
        return [{
            name: "Local delivery",
            isActive: true,
            baseGrams: cfg.baseGrams,
            stepGrams: cfg.stepGrams,
            freeAbovePaise: cfg.freeAbovePaise,
            neighbourhoods: cfg.neighbourhoods,
        }];
    }
    return [];
}

/** Does a parcel fit a vehicle's weight limit? (0 / unset = no limit) */
export function ownBoyVehicleFits(v: OwnBoyVehicle, weightGrams: number): boolean {
    const max = intOrZero(v.maxWeightGrams);
    return max <= 0 || weightGrams <= max;
}

/**
 * Union of the neighbourhoods a pincode has across all ACTIVE vehicles, grouped by
 * locality — drives the checkout Locality/Neighbourhood dropdowns. (Which vehicle
 * can actually take the parcel is decided later, at quote time, by weight + rate.)
 */
export function ownBoyAllNeighbourhoods(cfg: OwnBoyConfig, pincode: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const v of ownBoyVehicles(cfg)) {
        if (v.isActive === false) continue;
        for (const [loc, l] of Object.entries(ownBoyPincodeLocalities(v, pincode))) {
            out[loc] = [...new Set([...(out[loc] ?? []), ...l.neighbourhoods.map((n) => n.name)])];
        }
    }
    return out;
}

/**
 * The local boy's charge for a parcel, or NULL when the destination isn't
 * configured — no flat fallback. The rate is resolved by the ladder
 * (neighbourhood → locality); if neither is set the boy simply doesn't serve
 * there and no local-delivery option is offered. Free-above zeroes a resolved
 * rate over a subtotal.
 */
export function ownBoyRatePaise(
    cfg: OwnBoyMatrix,
    params: { weightGrams: number; subtotalPaise: number; pincode: string; locality?: string; neighbourhood?: string }
): number | null {
    const rate = resolveOwnBoyRate(cfg, params.pincode, params.locality, params.neighbourhood);
    if (!rate) return null; // not configured → not serviceable

    const freeAbove = intOrZero(cfg.freeAbovePaise);
    if (freeAbove > 0 && params.subtotalPaise >= freeAbove) return 0;

    const baseGrams = intOrZero(cfg.baseGrams) || 500;
    const stepGrams = intOrZero(cfg.stepGrams) || 500;
    return zoneSlabPaise(
        baseGrams,
        stepGrams,
        { name: "", pincodePrefixes: [], basePaise: rate.basePaise, addlPaise: rate.addlPaise },
        params.weightGrams
    );
}

/** Resolve base/addl via the ladder: neighbourhood rate → locality rate → null. */
function resolveOwnBoyRate(
    cfg: OwnBoyMatrix,
    pincode: string,
    locality?: string,
    neighbourhood?: string
): { basePaise: number; addlPaise: number } | null {
    const byLoc = ownBoyPincodeLocalities(cfg, pincode);
    // Locality: explicit, else the one containing the picked neighbourhood.
    let locObj = locality ? byLoc[locality.trim()] : undefined;
    if (!locObj && neighbourhood) {
        const nb = neighbourhood.trim();
        locObj = Object.values(byLoc).find((l) => l.neighbourhoods.some((n) => n.name === nb));
    }
    if (!locObj) return null;
    if (neighbourhood) {
        const nb = neighbourhood.trim();
        const n = locObj.neighbourhoods.find((x) => x.name === nb);
        if (n && (n.basePaise ?? 0) > 0) return { basePaise: n.basePaise!, addlPaise: n.addlPaise ?? n.basePaise! };
    }
    if ((locObj.basePaise ?? 0) > 0) return { basePaise: locObj.basePaise!, addlPaise: locObj.addlPaise ?? locObj.basePaise! };
    return null;
}

/** Clean a neighbourhood map: valid pincodes, trimmed names, deduped, empties dropped. */
export function sanitizeNeighbourhoods(raw: unknown): NbMap {
    if (!raw || typeof raw !== "object") return {};
    const out: NbMap = {};
    for (const [pin, locs] of Object.entries(raw as Record<string, unknown>)) {
        if (!/^\d{6}$/u.test(pin) || !locs || typeof locs !== "object") continue;
        const byLoc: Record<string, OwnBoyLocality> = {};
        for (const [loc, rawLoc] of Object.entries(locs as Record<string, unknown>)) {
            const locName = String(loc).trim();
            if (!locName) continue;
            const norm = normLocality(rawLoc);
            const seen = new Set<string>();
            norm.neighbourhoods = norm.neighbourhoods.filter((n) => {
                if (!n.name || seen.has(n.name)) return false;
                seen.add(n.name);
                return true;
            });
            if (norm.neighbourhoods.length > 0) byLoc[locName] = norm;
        }
        if (Object.keys(byLoc).length > 0) out[pin] = byLoc;
    }
    return out;
}

/** Clean the rate-bearing part of a local courier (slab weights + free-above + coverage). */
function sanitizeOwnBoyMatrix(raw: Record<string, unknown>): OwnBoyMatrix {
    return {
        freeAbovePaise: intOrZero(raw.freeAbovePaise),
        baseGrams: intOrZero(raw.baseGrams) || 500,
        stepGrams: intOrZero(raw.stepGrams) || 500,
        neighbourhoods: sanitizeNeighbourhoods(raw.neighbourhoods),
    };
}

/** Clean one local courier (vehicle): matrix + name + active + weight limit. */
function sanitizeOwnBoyVehicle(raw: unknown): OwnBoyVehicle {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return {
        ...sanitizeOwnBoyMatrix(r),
        name: String(r.name ?? "Vehicle").trim() || "Vehicle",
        isActive: r.isActive === undefined ? true : Boolean(r.isActive),
        maxWeightGrams: intOrZero(r.maxWeightGrams) || undefined,
    };
}

// ── Rate computation ──────────────────────────────────────────────────────

/** Price a zone's slab: base (first slab) + ceil(extra / step) additional slabs. */
function zoneSlabPaise(baseGrams: number, stepGrams: number, z: ZoneRate, weightGrams: number): number {
    const bg = Math.max(1, intOrZero(baseGrams) || 500);
    const sg = Math.max(1, intOrZero(stepGrams) || 500);
    const base = intOrZero(z.basePaise);
    const addl = intOrZero(z.addlPaise);
    if (weightGrams <= bg) return base;
    return base + Math.ceil((weightGrams - bg) / sg) * addl;
}

/**
 * Pick the zone for a destination. Priority, most specific first:
 *   1. Longest matching pincode prefix (finer than a state).
 *   2. Destination state listed in a zone's `states`.
 *   3. The default catch-all zone.
 */
function pickZone(zones: ZoneRate[], pincode: string, state?: string): ZoneRate | null {
    // 1. Pincode prefix (longest wins).
    let best: ZoneRate | null = null;
    let bestLen = -1;
    for (const z of zones) {
        for (const pre of z.pincodePrefixes ?? []) {
            const p = String(pre).trim();
            if (p && pincode.startsWith(p) && p.length > bestLen) {
                best = z;
                bestLen = p.length;
            }
        }
    }
    if (best) return best;
    // 2. State match.
    const st = (state ?? "").trim().toLowerCase();
    if (st) {
        const byState = zones.find((z) => (z.states ?? []).some((s) => String(s).trim().toLowerCase() === st));
        if (byState) return byState;
    }
    // 3. Default catch-all.
    return zones.find((z) => z.isDefault) ?? null;
}

/**
 * The Standard courier's charge for a parcel, or null when it can't serve the
 * pincode (ZONE mode with no matching zone and no default). Free-above zeroes the
 * forward charge. COD surcharge = MAX(flat fee, % of order value) — NOT flat + % —
 * matching the standard courier-industry convention (Shipway's rate-card T&C:
 * "Fixed price of COD or COD % of the order Value, whichever is higher").
 */
export function computeCustomRatePaise(
    cfg: RateCard,
    params: { weightGrams: number; subtotalPaise: number; deliveryPincode: string; deliveryState?: string; cod?: boolean }
): number | null {
    const freeAbove = intOrZero(cfg.freeAbovePaise);
    const free = freeAbove > 0 && params.subtotalPaise >= freeAbove;
    const mode = cfg.mode ?? "FLAT";

    let forward: number;
    if (mode === "ZONE") {
        const zone = pickZone(Array.isArray(cfg.zones) ? cfg.zones : [], params.deliveryPincode, params.deliveryState);
        if (!zone) return null; // not serviceable to this destination
        forward = free ? 0 : zoneSlabPaise(cfg.baseGrams ?? 500, cfg.stepGrams ?? 500, zone, params.weightGrams);
    } else {
        forward = free ? 0 : intOrZero(cfg.flatPaise);
    }

    let total = forward;
    if (params.cod) {
        const codFlat = intOrZero(cfg.codFlatPaise);
        const codPct = Math.round((params.subtotalPaise * (Number(cfg.codPercent) || 0)) / 100);
        total += Math.max(codFlat, codPct);
    }
    return total;
}

/**
 * The cheapest this card could charge for a parcel, ignoring destination — the
 * "from ₹X" figure shown before an address is known (e.g. the cart page). FLAT →
 * the flat rate; ZONE → the least of its zones for this weight. Free-above still
 * zeroes it. COD is not included (estimate assumes the base rate).
 */
export function cheapestCustomRatePaise(
    cfg: RateCard,
    params: { subtotalPaise: number; weightGrams: number }
): number | null {
    const freeAbove = intOrZero(cfg.freeAbovePaise);
    const free = freeAbove > 0 && params.subtotalPaise >= freeAbove;
    if ((cfg.mode ?? "FLAT") !== "ZONE") return free ? 0 : intOrZero(cfg.flatPaise);
    const zones = Array.isArray(cfg.zones) ? cfg.zones : [];
    if (zones.length === 0) return null;
    let min: number | null = null;
    for (const z of zones) {
        const p = free ? 0 : zoneSlabPaise(cfg.baseGrams ?? 500, cfg.stepGrams ?? 500, z, params.weightGrams);
        if (min == null || p < min) min = p;
    }
    return min;
}

// ── Sanitisers (operator input → stored config) ───────────────────────────

function sanitizeZone(raw: unknown): ZoneRate {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const prefixes = Array.isArray(r.pincodePrefixes)
        ? [...new Set(r.pincodePrefixes.map((p) => String(p).trim()).filter((p) => /^\d{1,6}$/u.test(p)))]
        : [];
    const states = Array.isArray(r.states)
        ? [...new Set(r.states.map((s) => canonicalStateName(String(s))).filter((s): s is string => !!s))]
        : [];
    return {
        name: String(r.name ?? "Zone").trim() || "Zone",
        pincodePrefixes: prefixes,
        states,
        isDefault: Boolean(r.isDefault),
        basePaise: intOrZero(r.basePaise),
        addlPaise: intOrZero(r.addlPaise),
        // 0 is stored as "unset" (falls back to the forward rate) — matches the
        // common real-world case where RTO wasn't given a distinct rate.
        rtoBasePaise: intOrZero(r.rtoBasePaise) || undefined,
        rtoAddlPaise: intOrZero(r.rtoAddlPaise) || undefined,
    };
}

/** Clean one rate card (mode + its mode-specific fields + COD surcharge). */
function sanitizeRateCard(raw: Record<string, unknown>): RateCard {
    const mode = (["FLAT", "ZONE"].includes(String(raw.mode)) ? raw.mode : "FLAT") as CustomRateMode;
    const out: RateCard = {
        mode,
        freeAbovePaise: intOrZero(raw.freeAbovePaise),
        codFlatPaise: intOrZero(raw.codFlatPaise),
        codPercent: Math.max(0, Number(raw.codPercent) || 0),
    };
    if (mode === "ZONE") {
        out.baseGrams = intOrZero(raw.baseGrams) || 500;
        out.stepGrams = intOrZero(raw.stepGrams) || 500;
        out.zones = Array.isArray(raw.zones) ? raw.zones.map(sanitizeZone) : [];
    } else {
        out.flatPaise = intOrZero(raw.flatPaise);
    }
    return out;
}

/** Clean a Standard-courier configJson: base rate card + optional service levels. */
export function sanitizeCustomConfig(raw: Record<string, unknown>): CustomConfig {
    const out: CustomConfig = sanitizeRateCard(raw);
    if (Array.isArray(raw.services)) {
        out.services = raw.services.map((s) => {
            const r = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
            return {
                ...sanitizeRateCard(r),
                name: String(r.name ?? "Service").trim() || "Service",
                isActive: r.isActive === undefined ? true : Boolean(r.isActive),
            };
        });
    }
    return out;
}

/**
 * Clean an operator-submitted configJson to only the fields a kind understands,
 * coercing types. Keeps the stored config tidy and predictable per kind.
 */
export function sanitizeDeliveryConfig(kind: DeliveryKind, raw: Record<string, unknown>): Record<string, unknown> {
    // Availability exclusions are common to every kind (only stored when non-empty).
    const exclude = sanitizeExclusions(raw.exclude);
    const hasExclude = (exclude.states?.length ?? 0) > 0 || (exclude.pincodePrefixes?.length ?? 0) > 0;
    // The Quick tick is common to every kind too (owner, 2026-11-22) — kept only when set.
    const quick = typeof raw.quick === "boolean" ? { quick: raw.quick } : {};
    const withExclude = (o: Record<string, unknown>): Record<string, unknown> =>
        ({ ...(hasExclude ? { ...o, exclude } : o), ...quick });

    if (kind === "CUSTOM") {
        return withExclude(sanitizeCustomConfig(raw) as Record<string, unknown>);
    }
    if (kind === "OWN_BOY") {
        const pincodes = Array.isArray(raw.pincodes)
            ? [...new Set(raw.pincodes.map((p) => String(p).trim()).filter((p) => /^\d{6}$/u.test(p)))]
            : [];
        const out: Record<string, unknown> = {
            pincodes,
            flatPaise: intOrZero(raw.flatPaise),
            ...sanitizeOwnBoyMatrix(raw),
        };
        // Local couriers (vehicles). Each is its own rate matrix + weight limit.
        if (Array.isArray(raw.vehicles)) out.vehicles = raw.vehicles.map(sanitizeOwnBoyVehicle);
        return withExclude(out);
    }
    if (kind === "STORE_PICKUP") {
        // Always ₹0 — the customer-facing pickup note + optional serve area
        // (empty serve area = offered everywhere).
        return withExclude({
            note: String(raw.note ?? "").trim().slice(0, 500),
            include: sanitizeExclusions(raw.include),
        });
    }
    if (kind === "FREE_DELIVERY") {
        // Serve list — same {states, pincodePrefixes} shape (and sanitizer) as
        // exclude. Always stored (even empty) so "empty = offered nowhere" is explicit.
        return withExclude({ include: sanitizeExclusions(raw.include) });
    }
    // SHIPROCKET / SHIPWAY — pickup config + exclusions (both aggregators, same shape).
    // SHIPWAY only: optional warehouseId override — booking normally auto-resolves
    // the Shipway warehouse whose pincode matches pickupPincode.
    return withExclude({
        pickupLocation: String(raw.pickupLocation ?? "").trim(),
        pickupPincode: String(raw.pickupPincode ?? "").trim(),
        defaultItemWeightGrams: intOrZero(raw.defaultItemWeightGrams) || 500,
        length: intOrZero(raw.length) || 15,
        breadth: intOrZero(raw.breadth) || 15,
        height: intOrZero(raw.height) || 10,
        ...(kind === "SHIPWAY" && intOrZero(raw.warehouseId) > 0
            ? { warehouseId: intOrZero(raw.warehouseId) }
            : {}),
    });
}
