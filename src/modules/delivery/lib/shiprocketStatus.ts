// Maps a Shiprocket shipment status onto our P8 Delivery pipeline stage. Used by
// the "Refresh tracking" action and the tracking webhook. Shiprocket reports both
// a numeric shipment_status_id and a human current_status string — we accept
// either. Returns null when the status doesn't warrant a stage change.
//
// P8 stages (bootstrap-seed.ts): S50 To Dispatch · S51 Carrier Assigned ·
// S52 Picked Up · S53 In Transit · S54 Out for Delivery · S55 Delivered ·
// S56 Failed / RTO (terminal).

export const DELIVERY_STAGE = {
    TO_DISPATCH: "S50",
    CARRIER_ASSIGNED: "S51",
    PICKED_UP: "S52",
    IN_TRANSIT: "S53",
    OUT_FOR_DELIVERY: "S54",
    DELIVERED: "S55",
    FAILED_RTO: "S56",
} as const;

// Customer-friendly wording for each stage — shown on the shop order page and
// the portal My Orders list, so internal stage codes never leak to customers.
export const DELIVERY_STAGE_LABEL: Record<string, string> = {
    [DELIVERY_STAGE.TO_DISPATCH]: "Preparing to dispatch",
    [DELIVERY_STAGE.CARRIER_ASSIGNED]: "Courier assigned",
    [DELIVERY_STAGE.PICKED_UP]: "Picked up",
    [DELIVERY_STAGE.IN_TRANSIT]: "In transit",
    [DELIVERY_STAGE.OUT_FOR_DELIVERY]: "Out for delivery",
    [DELIVERY_STAGE.DELIVERED]: "Delivered",
    [DELIVERY_STAGE.FAILED_RTO]: "Delivery failed / returned",
};

// Shiprocket numeric status codes → our stage. (The common, documented set; any
// code not here falls back to the string matcher, then to null.)
const BY_ID: Record<number, string> = {
    6: DELIVERY_STAGE.IN_TRANSIT, // SHIPPED
    7: DELIVERY_STAGE.DELIVERED, // DELIVERED
    8: DELIVERY_STAGE.FAILED_RTO, // CANCELED
    9: DELIVERY_STAGE.FAILED_RTO, // RTO INITIATED
    10: DELIVERY_STAGE.FAILED_RTO, // RTO DELIVERED
    17: DELIVERY_STAGE.OUT_FOR_DELIVERY, // OUT FOR DELIVERY
    18: DELIVERY_STAGE.IN_TRANSIT, // IN TRANSIT
    19: DELIVERY_STAGE.PICKED_UP, // OUT FOR PICKUP
    20: DELIVERY_STAGE.FAILED_RTO, // UNDELIVERED
    38: DELIVERY_STAGE.IN_TRANSIT, // REACHED DESTINATION HUB
    42: DELIVERY_STAGE.PICKED_UP, // PICKED UP
};

// Ordered string matchers — first substring hit wins. Order matters: check the
// more specific / terminal phrases before the generic ones.
const BY_TEXT: [RegExp, string][] = [
    [/rto|undeliver|cancel|lost|damaged/i, DELIVERY_STAGE.FAILED_RTO],
    [/out for delivery/i, DELIVERY_STAGE.OUT_FOR_DELIVERY],
    [/delivered/i, DELIVERY_STAGE.DELIVERED],
    [/in.?transit|shipped|reached|misroute|in.?flight/i, DELIVERY_STAGE.IN_TRANSIT],
    [/picked.?up|out for pickup/i, DELIVERY_STAGE.PICKED_UP],
    [/pickup|awb assigned|manifest|ready to ship/i, DELIVERY_STAGE.CARRIER_ASSIGNED],
];

export function shiprocketStatusToStage(input: { statusId?: number | null; status?: string | null }): string | null {
    if (input.statusId != null && BY_ID[input.statusId]) return BY_ID[input.statusId];
    const s = (input.status ?? "").trim();
    if (s) {
        for (const [re, stage] of BY_TEXT) if (re.test(s)) return stage;
    }
    return null;
}
