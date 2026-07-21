// Pure, client-safe delivery-method vocabulary + config helpers. NO prisma / no
// server-only imports, so both the Settings → Couriers client page and the
// server-side loaders (deliveryMethods.ts) can import from here without dragging
// the DB client into a client bundle.

export type DeliveryKind = "SHIPROCKET" | "CUSTOM" | "OWN_BOY";

export const DELIVERY_KINDS: DeliveryKind[] = ["OWN_BOY", "CUSTOM", "SHIPROCKET"];

export const DELIVERY_KIND_LABEL: Record<DeliveryKind, string> = {
    OWN_BOY: "Local delivery boy",
    CUSTOM: "Custom courier",
    SHIPROCKET: "Shiprocket",
};

/** Shiprocket: no stored rate — priced live by the serviceability API. */
export type ShiprocketConfig = {
    pickupLocation?: string; // registered pickup nickname in the Shiprocket panel
    pickupPincode?: string; // origin postcode for serviceability + rate
    defaultItemWeightGrams?: number; // fallback per unit when a product has no weight
    length?: number; // parcel dims (cm) sent to Shiprocket
    breadth?: number;
    height?: number;
};

/** Custom / manually-run courier: admin sets the rate on its own settings page. */
export type CustomConfig = {
    flatPaise?: number;
    freeAbovePaise?: number; // subtotal at/above which shipping is free (0/undef = never)
};

/** In-house delivery boy: offered only for the listed pincodes. */
export type OwnBoyConfig = {
    pincodes?: string[];
    flatPaise?: number;
    freeAbovePaise?: number;
};

export type DeliveryMethodRow = {
    id: number;
    kind: DeliveryKind;
    displayName: string;
    isActive: boolean;
    sortOrder: number;
    configJson: Record<string, unknown>;
};

/** Does a pincode fall inside the delivery boy's serviceable list? */
export function ownBoyServes(cfg: OwnBoyConfig, pincode: string): boolean {
    const pins = Array.isArray(cfg.pincodes) ? cfg.pincodes : [];
    return pins.map((p) => String(p).trim()).includes(pincode.trim());
}

const intOrZero = (v: unknown): number => Math.max(0, Math.round(Number(v) || 0));

/**
 * Clean an operator-submitted configJson to only the fields a kind understands,
 * coercing types. Keeps the stored config tidy and predictable per kind.
 */
export function sanitizeDeliveryConfig(kind: DeliveryKind, raw: Record<string, unknown>): Record<string, unknown> {
    if (kind === "CUSTOM") {
        return { flatPaise: intOrZero(raw.flatPaise), freeAbovePaise: intOrZero(raw.freeAbovePaise) };
    }
    if (kind === "OWN_BOY") {
        const pincodes = Array.isArray(raw.pincodes)
            ? [...new Set(raw.pincodes.map((p) => String(p).trim()).filter((p) => /^\d{6}$/u.test(p)))]
            : [];
        return { pincodes, flatPaise: intOrZero(raw.flatPaise), freeAbovePaise: intOrZero(raw.freeAbovePaise) };
    }
    // SHIPROCKET
    return {
        pickupLocation: String(raw.pickupLocation ?? "").trim(),
        pickupPincode: String(raw.pickupPincode ?? "").trim(),
        defaultItemWeightGrams: intOrZero(raw.defaultItemWeightGrams) || 500,
        length: intOrZero(raw.length) || 15,
        breadth: intOrZero(raw.breadth) || 15,
        height: intOrZero(raw.height) || 10,
    };
}
