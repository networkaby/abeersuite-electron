// Pure, client-safe. Chargeable weight = max(actual, volumetric) — the number
// couriers actually bill on. Volumetric uses the standard Indian courier divisor
// (L×B×H cm³ ÷ 5000 = kg), confirmed by the Shipway/Shiprocket rate-card T&Cs.

const VOLUMETRIC_DIVISOR = 5000; // cm³ per kg

export type Dims = {
    weightGrams?: number | null;
    lengthCm?: number | null;
    breadthCm?: number | null;
    heightCm?: number | null;
};

/** Volumetric weight in grams for L×B×H (cm). 0 when any dimension is missing. */
export function volumetricGrams(lengthCm?: number | null, breadthCm?: number | null, heightCm?: number | null): number {
    const l = Number(lengthCm) || 0;
    const b = Number(breadthCm) || 0;
    const h = Number(heightCm) || 0;
    if (l <= 0 || b <= 0 || h <= 0) return 0;
    // (L*B*H cm³ / 5000) kg → grams. = L*B*H / 5.
    return Math.round((l * b * h * 1000) / VOLUMETRIC_DIVISOR);
}

/**
 * Chargeable weight of ONE unit (grams): the greater of actual and volumetric.
 * When the product has no actual weight, `fallbackGrams` stands in for it (still
 * compared against volumetric).
 */
export function chargeableUnitGrams(p: Dims, fallbackGrams: number): number {
    const actual = Number(p.weightGrams) || 0;
    const base = actual > 0 ? actual : Math.max(0, fallbackGrams);
    return Math.max(base, volumetricGrams(p.lengthCm, p.breadthCm, p.heightCm));
}
