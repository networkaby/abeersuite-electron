// SERVER-ONLY Shipway API client — a second rate aggregator alongside Shiprocket.
// Credentials come from env (SHIPWAY_USERNAME / SHIPWAY_LICENSE); non-secret config
// (pickup pincode, default weight, parcel dims) from the SHIPWAY DeliveryMethod row.
// Everything degrades to "not configured" / [] when the env creds are absent or the
// API call fails, so checkout still works with the other couriers.
//
// ⚠️ ENDPOINT/SHAPE TO VERIFY: Shipway's live API docs (https://apidocs.shipway.com)
// render client-side, so the exact rate/serviceability path + response mapping below
// are a best-effort against Shipway's v2 shape and MUST be confirmed against the docs
// (or a live test with real creds). The function fails safe — a wrong path or an auth
// error returns [] and Shipway is simply dropped from the checkout list; it never
// breaks the quote. Base URL is overridable via SHIPWAY_API_BASE without a code change.

const BASE = process.env.SHIPWAY_API_BASE?.trim() || "https://app.shipway.com/api";

function creds(): { username: string | null; license: string | null } {
    return {
        username: process.env.SHIPWAY_USERNAME?.trim() || null,
        license: process.env.SHIPWAY_LICENSE?.trim() || null,
    };
}

/** True when the Shipway API credentials are present in env. */
export function shipwayEnvReady(): boolean {
    const c = creds();
    return !!(c.username && c.license);
}

/** Shipway sends credentials as an HTTP Basic header (username : license key). */
function authHeader(): string {
    const c = creds();
    const raw = `${c.username ?? ""}:${c.license ?? ""}`;
    return `Basic ${Buffer.from(raw).toString("base64")}`;
}

const toPaise = (rupees: unknown): number => Math.round(Number(rupees ?? 0) * 100) || 0;

export type ShipwayCourierQuote = {
    courierId: string; // Shipway courier/carrier id (string — used later for AWB)
    courierName: string;
    ratePaise: number;
    etaDays: number | null;
    etaText: string | null;
};

/**
 * Available couriers + rates for a pincode pair and parcel weight. Returns [] on
 * any failure so the caller can simply drop the Shipway options from checkout.
 */
export async function shipwayServiceability(params: {
    pickupPincode: string;
    deliveryPincode: string;
    weightGrams: number;
    cod: boolean;
}): Promise<ShipwayCourierQuote[]> {
    if (!shipwayEnvReady()) return [];
    const weightKg = Math.max(0.05, params.weightGrams / 1000);

    // ⚠️ VERIFY: path + body + response keys against apidocs.shipway.com.
    const body = {
        from_pincode: params.pickupPincode,
        to_pincode: params.deliveryPincode,
        weight: weightKg,
        payment_type: params.cod ? "cod" : "prepaid",
    };
    type Resp = {
        // Shipway commonly wraps a list of carriers with rate + estimated days.
        courier?: Array<{
            id?: number | string;
            courier_id?: number | string;
            name?: string;
            courier_name?: string;
            total_charge?: number | string;
            charges?: number | string;
            rate?: number | string;
            estimated_delivery_days?: number | string;
            edd?: string;
        }>;
        data?: unknown;
    };
    try {
        const res = await fetch(`${BASE}/getCarrierRates`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader() },
            body: JSON.stringify(body),
        });
        if (!res.ok) return [];
        const json = (await res.json().catch(() => ({}))) as Resp;
        const list = Array.isArray(json.courier) ? json.courier : [];
        return list
            .map((c) => {
                const rate = c.total_charge ?? c.charges ?? c.rate;
                const days = c.estimated_delivery_days;
                return {
                    courierId: String(c.courier_id ?? c.id ?? ""),
                    courierName: String(c.courier_name ?? c.name ?? "Shipway courier"),
                    ratePaise: toPaise(rate),
                    etaDays: days != null ? Number(days) || null : null,
                    etaText: c.edd ?? null,
                };
            })
            .filter((c) => c.courierId && c.ratePaise > 0);
    } catch {
        return [];
    }
}
