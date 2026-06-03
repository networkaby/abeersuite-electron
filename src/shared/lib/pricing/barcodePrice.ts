// ── barcodePrice ─────────────────────────────────────────────────────────────
// The printed barcode (tag) price is DERIVED from the saved sale price, not
// stored. A band-based buffer is added to the sale price to leave headroom on
// the printed label; the buffered value is rounded to the nearest 10, then a
// per-band "hint" digit is set as the units digit (silently encoding which band
// applied to staff). MRP cap: when MRP is tight the barcode floors to MRP
// (trailing 0 = capped); if even that drops below the sale price, print MRP
// exactly (hint "m").
//
// This is the SINGLE source of truth so the tag a customer sees on the shelf
// equals the tag on the receipt: the pricing "Update & Print Labels" page, the
// products lookup API (POS line snapshot), and any future caller share it.
// Bands live on OrgDefaults.barcodeBandsJson; DEFAULT_BARCODE_BANDS is the seed
// fallback used when no config is present.

export type BarcodeBand = { max: number; add: number; hint: number };

export const DEFAULT_BARCODE_BANDS: BarcodeBand[] = [
    { max: 50, add: 10, hint: 1 },
    { max: 100, add: 20, hint: 2 },
    { max: 300, add: 30, hint: 3 },
    { max: 500, add: 50, hint: 5 },
    { max: 2000, add: 100, hint: 6 },
    { max: 5000, add: 150, hint: 7 },
    { max: 10000, add: 200, hint: 8 },
    { max: 99999, add: 500, hint: 9 },
];

/**
 * Coerce a raw OrgDefaults.barcodeBandsJson value into a clean ascending-by-max
 * band list, falling back to the defaults when absent / empty / malformed.
 * `find(price <= max)` relies on the ascending order.
 */
export function normalizeBarcodeBands(raw: unknown): BarcodeBand[] {
    if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_BARCODE_BANDS;
    const bands = raw.filter(
        (b): b is BarcodeBand =>
            !!b && typeof b === "object" &&
            typeof (b as BarcodeBand).max === "number" &&
            typeof (b as BarcodeBand).add === "number" &&
            typeof (b as BarcodeBand).hint === "number",
    );
    return bands.length ? [...bands].sort((a, b) => a.max - b.max) : DEFAULT_BARCODE_BANDS;
}

/**
 * Printed barcode price (rupees) for a saved sale price, capped to MRP.
 * `bands` must be ascending-by-max (use normalizeBarcodeBands on stored config).
 */
export function barcodePrice(
    price: number | null,
    mrp: number | null = null,
    bands: BarcodeBand[] = DEFAULT_BARCODE_BANDS,
): { value: number | null; hint: string; capped: boolean } {
    if (price == null || !isFinite(price) || price < 1) return { value: null, hint: "", capped: false };
    const band = bands.find((b) => price <= b.max);
    let value = band ? Math.round((price + band.add) / 10) * 10 + band.hint : Math.round(price);
    let hint = band ? String(band.hint) : "";
    let capped = false;
    if (mrp != null && mrp > 0 && value > mrp) {
        const floored = Math.floor(mrp / 10) * 10;
        if (floored >= price) {
            value = floored;
            hint = "0";
        } else {
            value = mrp;
            hint = "m";
        }
        capped = true;
    }
    return { value, hint, capped };
}

/**
 * Convenience for line snapshots: the printed barcode tag in PAISE, derived from
 * the saved sale price + MRP (both paise). Returns null when there is no saved
 * price (no tag to print).
 */
export function barcodeTagPaise(
    savedPaise: number | null | undefined,
    mrpPaise: number | null | undefined,
    bands: BarcodeBand[] = DEFAULT_BARCODE_BANDS,
): number | null {
    if (savedPaise == null) return null;
    const v = barcodePrice(savedPaise / 100, mrpPaise != null ? mrpPaise / 100 : null, bands).value;
    return v == null ? null : Math.round(v * 100);
}
