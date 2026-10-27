/**
 * Storefront tracking codes (Settings → Tracking Codes), stored on
 * OrgDefaults.trackingCodesJson. Client-safe: the settings form and the shop
 * share this shape; the cached server loader lives in trackingCodes.server.ts.
 */

export type TrackingCodes = {
    ga4Enabled: boolean;
    ga4Id: string;
    gtmEnabled: boolean;
    gtmId: string;
    metaPixelEnabled: boolean;
    metaPixelId: string;
    tiktokPixelEnabled: boolean;
    tiktokPixelId: string;
    customEnabled: boolean;
    /** Raw HTML appended to <head> — scripts in it run. */
    customHead: string;
    /** Raw HTML appended to the end of <body>. */
    customBody: string;
};

export const DEFAULT_TRACKING_CODES: TrackingCodes = {
    ga4Enabled: false,
    ga4Id: "",
    gtmEnabled: false,
    gtmId: "",
    metaPixelEnabled: false,
    metaPixelId: "",
    tiktokPixelEnabled: false,
    tiktokPixelId: "",
    customEnabled: false,
    customHead: "",
    customBody: "",
};

/** What each id box accepts — ids go into inline script, so nothing else may pass. */
export const TRACKING_ID_PATTERNS = {
    ga4Id: /^G-[A-Z0-9]{4,20}$/,
    gtmId: /^GTM-[A-Z0-9]{4,12}$/,
    metaPixelId: /^\d{6,20}$/,
    tiktokPixelId: /^[A-Z0-9]{8,30}$/,
} as const;

/** Tolerant read of the stored JSON — unknown keys dropped, bad ids blanked. */
export function normalizeTrackingCodes(raw: unknown): TrackingCodes {
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const bool = (k: keyof TrackingCodes) => r[k] === true;
    const str = (k: keyof TrackingCodes) => (typeof r[k] === "string" ? (r[k] as string) : "");
    const id = (k: keyof typeof TRACKING_ID_PATTERNS) => {
        const v = str(k).trim().toUpperCase();
        return TRACKING_ID_PATTERNS[k].test(v) ? v : "";
    };
    return {
        ga4Enabled: bool("ga4Enabled"),
        ga4Id: id("ga4Id"),
        gtmEnabled: bool("gtmEnabled"),
        gtmId: id("gtmId"),
        metaPixelEnabled: bool("metaPixelEnabled"),
        metaPixelId: id("metaPixelId"),
        tiktokPixelEnabled: bool("tiktokPixelEnabled"),
        tiktokPixelId: id("tiktokPixelId"),
        customEnabled: bool("customEnabled"),
        customHead: str("customHead"),
        customBody: str("customBody"),
    };
}

type TrackWindow = Window & {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    ttq?: { track: (event: string, data: unknown) => void };
    dataLayer?: unknown[];
};

/**
 * Tell every loaded tracker a shop order was placed. Safe to call when no
 * tracker is set up — each call is skipped unless its script is on the page.
 */
export function trackPurchase(orderId: number, value: number, currency = "INR"): void {
    if (typeof window === "undefined") return;
    const w = window as TrackWindow;
    try {
        w.gtag?.("event", "purchase", { transaction_id: String(orderId), value, currency });
        w.fbq?.("track", "Purchase", { value, currency });
        w.ttq?.track("CompletePayment", { value, currency });
        w.dataLayer?.push({ event: "purchase", ecommerce: { transaction_id: String(orderId), value, currency } });
    } catch {
        // A tracker's own error must never break checkout.
    }
}
