// Maps a Shipway shipment status onto our P8 Delivery pipeline stage. Used by
// the Shipway tracking webhook and the poll fallback. Shipway reports a short
// status code (shipment_status: SCH / INT / OFD / DEL / PKF …) on the tracking
// API and a free-text scan line (scans_current_status) on the webhook — we
// accept either. Returns null when the status doesn't warrant a stage change.

import { DELIVERY_STAGE } from "./shiprocketStatus";

// Documented Shipway shipment_status codes → our stage.
const BY_CODE: Record<string, string> = {
    SCH: DELIVERY_STAGE.CARRIER_ASSIGNED, // Scheduled (AWB assigned, awaiting pickup)
    PKP: DELIVERY_STAGE.PICKED_UP, // Picked up
    PUP: DELIVERY_STAGE.PICKED_UP,
    INT: DELIVERY_STAGE.IN_TRANSIT, // In transit
    OFD: DELIVERY_STAGE.OUT_FOR_DELIVERY, // Out for delivery
    DEL: DELIVERY_STAGE.DELIVERED, // Delivered
    RTO: DELIVERY_STAGE.FAILED_RTO,
    CAN: DELIVERY_STAGE.FAILED_RTO, // Cancelled
    UND: DELIVERY_STAGE.FAILED_RTO, // Undelivered
    LOST: DELIVERY_STAGE.FAILED_RTO,
    // PKF (pickup failed) / PCAN (pickup cancelled) / NFI (no info): stay put —
    // the delivery remains Carrier Assigned until a real movement scan.
};

// Ordered free-text matchers — first substring hit wins (same order philosophy
// as the Shiprocket matcher: terminal phrases before generic ones).
const BY_TEXT: [RegExp, string][] = [
    [/rto|undeliver|cancel|lost|damaged|return/i, DELIVERY_STAGE.FAILED_RTO],
    [/out for delivery/i, DELIVERY_STAGE.OUT_FOR_DELIVERY],
    [/delivered/i, DELIVERY_STAGE.DELIVERED],
    [/in.?transit|shipped|reached|misroute|in.?flight|forwarded/i, DELIVERY_STAGE.IN_TRANSIT],
    [/picked.?up|out for pickup/i, DELIVERY_STAGE.PICKED_UP],
    [/pickup|awb|manifest|ready to ship|scheduled/i, DELIVERY_STAGE.CARRIER_ASSIGNED],
];

export function shipwayStatusToStage(input: { code?: string | null; status?: string | null }): string | null {
    const code = (input.code ?? "").trim().toUpperCase();
    if (code && BY_CODE[code]) return BY_CODE[code];
    const s = (input.status ?? "").trim();
    if (s) {
        for (const [re, stage] of BY_TEXT) if (re.test(s)) return stage;
    }
    return null;
}
