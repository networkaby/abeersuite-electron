// SERVER-ONLY Shipway API client — a second rate aggregator alongside Shiprocket.
// Non-secret config (pickup pincode, default weight, dims) comes from the SHIPWAY
// DeliveryMethod row; the API token from env. Everything degrades to [] when the
// token is absent or the call fails, so checkout still works with other couriers.
//
// Rate API (https://apidocs.shipway.com → Rate API → Carrier Rates):
//   GET https://app.shipway.com/api/getshipwaycarrierrates
//       ?fromPincode=400703&toPincode=400706&paymentType=prepaid[&weight=0.5]
//   Auth: HTTP Basic — Authorization: Basic base64(EMAIL:LICENSE_KEY)
//         (SHIPWAY_USERNAME = account email, SHIPWAY_LICENSE = License Key from
//          Shipway → Profile → Manage profile).
//   200 → { success: "success", rate_card: [ { carrier_id, courier_name,
//           delivery_charge (₹), rto_charge, charged_weight (kg), zone }, … ] }

const BASE = process.env.SHIPWAY_API_BASE?.trim() || "https://app.shipway.com/api";

/** The full Authorization header value — HTTP Basic base64(email:licenseKey).
 *  SHIPWAY_TOKEN, if set, is used verbatim (an escape hatch / pre-built header). */
function authHeader(): string | null {
    const token = process.env.SHIPWAY_TOKEN?.trim();
    if (token) return token;
    const email = process.env.SHIPWAY_USERNAME?.trim();
    const license = process.env.SHIPWAY_LICENSE?.trim();
    if (email && license) return `Basic ${Buffer.from(`${email}:${license}`).toString("base64")}`;
    return null;
}

/** True when Shipway credentials (email + license key) are present in env. */
export function shipwayEnvReady(): boolean {
    return authHeader() != null;
}

const toPaise = (rupees: unknown): number => Math.round(Number(rupees ?? 0) * 100) || 0;

export type ShipwayCourierQuote = {
    courierId: string; // Shipway carrier_id (used later for booking)
    courierName: string;
    ratePaise: number;
    etaDays: number | null;
    etaText: string | null;
};

/**
 * Available carriers + rates for a pincode pair and parcel weight. Returns [] on
 * any failure so the caller can simply drop the Shipway options from checkout.
 */
export async function shipwayServiceability(params: {
    pickupPincode: string;
    deliveryPincode: string;
    weightGrams: number;
    cod: boolean;
}): Promise<ShipwayCourierQuote[]> {
    const header = authHeader();
    if (!header) return [];
    const weightKg = Math.max(0.05, params.weightGrams / 1000);
    const qs = new URLSearchParams({
        fromPincode: params.pickupPincode,
        toPincode: params.deliveryPincode,
        paymentType: params.cod ? "cod" : "prepaid",
        weight: String(weightKg),
    });
    type Resp = {
        success?: string;
        rate_card?: Array<{
            carrier_id?: number | string;
            courier_name?: string;
            delivery_charge?: number | string;
            estimated_delivery_days?: number | string;
            edd?: string;
        }>;
    };
    try {
        const res = await fetch(`${BASE}/getshipwaycarrierrates?${qs.toString()}`, {
            method: "GET",
            headers: { Authorization: header },
        });
        if (!res.ok) return [];
        const json = (await res.json().catch(() => ({}))) as Resp;
        const list = Array.isArray(json.rate_card) ? json.rate_card : [];
        return list
            .map((c) => {
                const days = c.estimated_delivery_days;
                return {
                    courierId: String(c.carrier_id ?? ""),
                    // Drop Shipway's own brand prefix from the courier name — we show
                    // the underlying carrier (Delhivery, Xpressbees…), not "Shipway".
                    courierName:
                        String(c.courier_name ?? "")
                            .replace(/\bshipway\b/giu, "")
                            .replace(/\s+/gu, " ")
                            .trim() || "Courier",
                    ratePaise: toPaise(c.delivery_charge),
                    etaDays: days != null ? Number(days) || null : null,
                    etaText: c.edd ?? null,
                };
            })
            .filter((c) => c.courierId && c.ratePaise > 0);
    } catch {
        return [];
    }
}
