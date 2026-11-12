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

import { appSetting } from "@/shared/lib/settings/appSettings.server";

const BASE = process.env.SHIPWAY_API_BASE?.trim() || "https://app.shipway.com/api";

/** The full Authorization header value — HTTP Basic base64(email:licenseKey).
 *  SHIPWAY_TOKEN, if set, is used verbatim (an escape hatch / pre-built header). */
async function authHeader(): Promise<string | null> {
    const token = process.env.SHIPWAY_TOKEN?.trim();
    if (token) return token;
    const email = await appSetting("SHIPWAY_USERNAME");
    const license = await appSetting("SHIPWAY_LICENSE");
    if (email && license) return `Basic ${Buffer.from(`${email}:${license}`).toString("base64")}`;
    return null;
}

/** True when Shipway credentials (email + license key) are present in env. */
export async function shipwayEnvReady(): Promise<boolean> {
    return (await authHeader()) != null;
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
/** Authenticated Shipway fetch — throws with the API's message on failure. */
async function swFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const header = await authHeader();
    if (!header) throw new Error("Shipway credentials are not configured");
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: header, ...(init.headers ?? {}) },
    });
    const json = (await res.json().catch(() => ({}))) as T & { success?: boolean | string; message?: string };
    if (!res.ok) throw new Error(json?.message || `Shipway request failed (${res.status})`);
    return json;
}

// ── Warehouses (Shipway-side pickup locations; booking needs a warehouse_id) ──
export type ShipwayWarehouse = { warehouseId: string; title: string; pincode: string };

export async function shipwayGetWarehouses(): Promise<ShipwayWarehouse[]> {
    type Resp = { message?: Array<{ warehouse_id?: number | string; title?: string; pincode?: string }> } & Record<string, unknown>;
    const json = await swFetch<Resp>(`/getwarehouses`, { method: "GET" });
    // The list rides on `message` (Shipway's shape); tolerate a top-level array too.
    const list = Array.isArray(json.message) ? json.message : Array.isArray(json) ? (json as unknown as Resp["message"]) : [];
    return (list ?? [])
        .map((w) => ({
            warehouseId: String(w.warehouse_id ?? ""),
            title: String(w.title ?? ""),
            pincode: String(w.pincode ?? ""),
        }))
        .filter((w) => w.warehouseId);
}

// ── Booking: push order WITH label generation (create + AWB + label, one call) ─
export type ShipwayOrderItem = { product: string; price: string; product_code: string; product_quantity: string };
export type ShipwayPushOrder = {
    order_id: string;
    carrier_id: number;
    warehouse_id: string;
    return_warehouse_id: string;
    products: ShipwayOrderItem[];
    discount: string;
    shipping: string;
    order_total: string;
    taxes: string;
    payment_type: "P" | "C"; // Prepaid / COD
    email?: string;
    billing_address: string;
    billing_address2?: string;
    billing_city: string;
    billing_state: string;
    billing_country: string;
    billing_firstname: string;
    billing_lastname: string;
    billing_phone: string;
    billing_zipcode: string;
    shipping_address: string;
    shipping_address2?: string;
    shipping_city: string;
    shipping_state: string;
    shipping_country: string;
    shipping_firstname: string;
    shipping_lastname: string;
    shipping_phone: string;
    shipping_zipcode: string;
    order_weight: string; // grams
    box_length?: string;
    box_breadth?: string;
    box_height?: string;
    order_date?: string; // YYYY-MM-DD
};

export async function shipwayCreateOrderWithLabel(
    payload: ShipwayPushOrder,
): Promise<{ awb: string; carrierId: string | null; labelUrl: string | null }> {
    type Resp = {
        success?: boolean | string;
        message?: string;
        awb_response?: {
            success?: boolean | string;
            message?: string;
            AWB?: string | number;
            carrier_id?: string | number;
            shipping_url?: string;
        };
    };
    const json = await swFetch<Resp>(`/v2orders`, { method: "POST", body: JSON.stringify(payload) });
    if (json.success === false) throw new Error(json.message || "Shipway rejected the order");
    const awbr = json.awb_response;
    const awb = awbr?.AWB != null ? String(awbr.AWB) : "";
    if (!awb) {
        throw new Error(
            awbr?.message || json.message || "Shipway created the order but did not assign an AWB",
        );
    }
    return {
        awb,
        carrierId: awbr?.carrier_id != null ? String(awbr.carrier_id) : null,
        labelUrl: awbr?.shipping_url ?? null,
    };
}

/** Create the pickup manifest for booked orders — the sheet the courier's agent
 *  signs at handover. Shipway returns a manifest ID (the PDF is downloaded from
 *  the Shipway panel — no print URL in the API). */
export async function shipwayCreateManifest(orderIds: string[]): Promise<{ manifestIds: string | null; message: string | null }> {
    type Resp = { status?: boolean; success?: boolean; error?: unknown; message?: string; "manifest ids"?: string };
    const json = await swFetch<Resp>(`/Createmanifest/`, {
        method: "POST",
        body: JSON.stringify({ order_ids: orderIds }),
    });
    if (json.success === false || json.status === false) {
        throw new Error(json.message || "Shipway could not create the manifest");
    }
    return { manifestIds: json["manifest ids"] ?? null, message: json.message ?? null };
}

// ── Pickup scheduling (best-effort — Shipway may auto-schedule per carrier) ───
export async function shipwayCreatePickup(params: {
    carrierId: string | number;
    warehouseId: string;
    orderIds: string[];
    cod: boolean;
}): Promise<{ message: string | null }> {
    type Resp = { success?: string; error?: number; message?: string };
    const now = new Date();
    // Ask for pickup tomorrow at a safe mid-day slot (today's cutoffs vary by carrier).
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const json = await swFetch<Resp>(`/createpickup/`, {
        method: "POST",
        body: JSON.stringify({
            pickup_date: tomorrow.toISOString().slice(0, 10),
            pickup_time: "12:00",
            office_close_time: "19:00",
            package_count: String(params.orderIds.length),
            carrier_id: String(params.carrierId),
            warehouse_id: params.warehouseId,
            return_warehouse_id: params.warehouseId,
            payment_type: params.cod ? "C" : "P",
            order_ids: params.orderIds,
        }),
    });
    return { message: json.message ?? null };
}

// ── Tracking (poll fallback; the webhook is the primary sync) ─────────────────
export type ShipwayTracking = {
    statusCode: string | null; // SCH / INT / OFD / DEL / …
    currentStatus: string | null; // free-text latest scan
    trackUrl: string | null;
};

export async function shipwayTrackByAwb(awb: string): Promise<ShipwayTracking> {
    type Resp = Array<{
        awb?: string | number;
        error?: string;
        tracking_details?: {
            shipment_status?: string;
            shipment_details?: Array<{ current_status?: string }>;
            track_url?: string;
        };
    }>;
    const json = await swFetch<Resp>(`/tracking?awb_numbers=${encodeURIComponent(awb)}&tracking_history=0`, {
        method: "GET",
    });
    const row = Array.isArray(json) ? json[0] : undefined;
    if (!row || row.error) throw new Error(row?.error || "AWB not found on Shipway");
    return {
        statusCode: row.tracking_details?.shipment_status ?? null,
        currentStatus: row.tracking_details?.shipment_details?.[0]?.current_status ?? null,
        trackUrl: row.tracking_details?.track_url ?? null,
    };
}

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
    const header = await authHeader();
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
