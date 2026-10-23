/**
 * Offer-product slides for the customer display's idle slideshow (QR display,
 * DQ11). Shared by the API that picks them (/api/pos/display-slides), the POS
 * hook that hands them to the bridge, and the settings page. The bridge draws
 * and keeps them (hardware-bridge/qr.js, `idle/products`) and plays them mixed
 * with the photos in the counter's folder.
 */

/** One product slide — rupees, tax-inclusive, as the shop shows them. */
export type QrSlideProduct = {
    id: number;
    name: string;
    price: number;
    /** Struck through when higher than price; null = no saving to show. */
    mrp: number | null;
    badge: string | null;
    /** Absolute photo link — the bridge fetches it once per change. */
    image: string;
};

/** Most products the API hands out; the counter's own setting picks fewer. */
export const QR_SLIDE_PRODUCTS_MAX = 50;

/** The counter's default when its setting is blank. */
export const QR_SLIDE_PRODUCTS_DEFAULT = 20;

/** How often an open POS refreshes the list for the bridge. */
export const QR_SLIDES_REFRESH_MS = 3 * 60 * 60 * 1000;
