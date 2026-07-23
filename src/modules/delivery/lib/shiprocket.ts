// SERVER-ONLY Shiprocket API client (https://apiv2.shiprocket.in/v1/external).
// Credentials come from env (SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD); non-secret
// config (pickup location, default weight, parcel dims) from the SHIPROCKET
// DeliveryMethod row. The auth token is valid ~240h — cached in-module and
// refreshed on expiry or a 401. Everything degrades to "not configured" when the
// env creds are absent, so checkout still works with the CUSTOM / OWN_BOY couriers.

const BASE = "https://apiv2.shiprocket.in/v1/external";
// Refresh a little before Shiprocket's 240h expiry.
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000;

let cachedToken: { token: string; expiresAt: number } | null = null;

function creds(): { email: string | null; password: string | null } {
    return {
        email: process.env.SHIPROCKET_EMAIL?.trim() || null,
        password: process.env.SHIPROCKET_PASSWORD?.trim() || null,
    };
}

/** True when the API user credentials are present in env. */
export function shiprocketEnvReady(): boolean {
    const c = creds();
    return !!(c.email && c.password);
}

async function login(): Promise<string> {
    const c = creds();
    if (!c.email || !c.password) throw new Error("Shiprocket credentials are not configured");
    const res = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: c.email, password: c.password }),
    });
    const json = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
    if (!res.ok || !json.token) {
        throw new Error(json.message || `Shiprocket login failed (${res.status})`);
    }
    cachedToken = { token: json.token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return json.token;
}

async function getToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
    return login();
}

/** Authenticated fetch that refreshes the token once on a 401. */
async function srFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = await getToken();
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(init.headers ?? {}),
        },
    });
    if (res.status === 401 && retry) {
        cachedToken = null;
        return srFetch<T>(path, init, false);
    }
    const json = (await res.json().catch(() => ({}))) as T & { message?: string; errors?: unknown };
    if (!res.ok) {
        // Shiprocket's `message` is often a generic "Oops! Invalid Data." — the
        // real field-level reasons ride in `errors`; append them so staff see WHY.
        const detail = json?.errors ? ` — ${JSON.stringify(json.errors)}` : "";
        throw new Error((json?.message || `Shiprocket request failed (${res.status})`) + detail);
    }
    return json;
}

const toPaise = (rupees: unknown): number => Math.round(Number(rupees ?? 0) * 100) || 0;

// ── Serviceability / rate (drives the checkout quote) ─────────────────────────
export type SrCourierQuote = {
    courierId: number;
    courierName: string;
    ratePaise: number;
    etaDays: number | null;
    etaText: string | null;
};

/**
 * Available couriers + rates for a pincode pair and parcel weight.
 * weightGrams is converted to kg for the API. Returns [] on any failure so the
 * caller can simply drop the Shiprocket option from the checkout list.
 */
export async function shiprocketServiceability(params: {
    pickupPincode: string;
    deliveryPincode: string;
    weightGrams: number;
    cod: boolean;
}): Promise<SrCourierQuote[]> {
    const weightKg = Math.max(0.05, params.weightGrams / 1000).toFixed(2);
    const qs = new URLSearchParams({
        pickup_postcode: params.pickupPincode,
        delivery_postcode: params.deliveryPincode,
        weight: weightKg,
        cod: params.cod ? "1" : "0",
    });
    type Resp = {
        data?: {
            available_courier_companies?: Array<{
                courier_company_id: number;
                courier_name: string;
                rate: number;
                estimated_delivery_days?: string | number;
                etd?: string;
            }>;
        };
    };
    try {
        const json = await srFetch<Resp>(`/courier/serviceability/?${qs.toString()}`, { method: "GET" });
        const list = json.data?.available_courier_companies ?? [];
        return list.map((c) => ({
            courierId: c.courier_company_id,
            courierName: c.courier_name,
            ratePaise: toPaise(c.rate),
            etaDays: c.estimated_delivery_days != null ? Number(c.estimated_delivery_days) || null : null,
            etaText: c.etd ?? null,
        }));
    } catch {
        return [];
    }
}

/** The cheapest available courier for a parcel, or null when none serviceable. */
export async function shiprocketCheapest(params: {
    pickupPincode: string;
    deliveryPincode: string;
    weightGrams: number;
    cod: boolean;
}): Promise<SrCourierQuote | null> {
    const list = await shiprocketServiceability(params);
    if (list.length === 0) return null;
    return list.reduce((best, c) => (c.ratePaise < best.ratePaise ? c : best));
}

// ── Order → shipment → AWB → pickup → label (fulfilment, wired in Phase 3) ────
export type SrAdhocItem = { name: string; sku: string; units: number; selling_price: number };
export type SrAdhocOrder = {
    order_id: string;
    order_date: string;
    pickup_location: string;
    billing_customer_name: string;
    billing_last_name?: string;
    billing_address: string;
    billing_city: string;
    billing_pincode: string;
    billing_state: string;
    billing_country: string;
    billing_email?: string;
    billing_phone: string;
    shipping_is_billing: boolean;
    order_items: SrAdhocItem[];
    payment_method: "COD" | "Prepaid";
    sub_total: number;
    length: number;
    breadth: number;
    height: number;
    weight: number; // kg
};

export async function shiprocketCreateAdhoc(payload: SrAdhocOrder): Promise<{ orderId: string; shipmentId: string }> {
    type Resp = { order_id?: number | string; shipment_id?: number | string };
    const json = await srFetch<Resp>(`/orders/create/adhoc`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    if (!json.shipment_id) throw new Error("Shiprocket did not return a shipment id");
    return { orderId: String(json.order_id ?? ""), shipmentId: String(json.shipment_id) };
}

export async function shiprocketAssignAwb(
    shipmentId: string,
    courierId?: number
): Promise<{ awb: string; courierName: string | null }> {
    type Resp = {
        response?: { data?: { awb_code?: string; courier_name?: string; awb_assign_error?: string } };
        awb_code?: string;
        message?: string;
        awb_assign_status?: number;
    };
    const json = await srFetch<Resp>(`/courier/assign/awb`, {
        method: "POST",
        body: JSON.stringify({ shipment_id: shipmentId, ...(courierId ? { courier_id: courierId } : {}) }),
    });
    const awb = json.response?.data?.awb_code ?? json.awb_code;
    if (!awb) {
        // Assign failures often come back HTTP 200 with the reason in the body
        // (e.g. insufficient wallet balance) — surface it instead of a mystery.
        const why = json.response?.data?.awb_assign_error || json.message;
        throw new Error(why ? `AWB assignment failed: ${why}` : "Shiprocket did not return an AWB");
    }
    return { awb, courierName: json.response?.data?.courier_name ?? null };
}

export async function shiprocketGeneratePickup(shipmentId: string): Promise<{ status: string | null }> {
    type Resp = { pickup_status?: number | string; response?: string };
    const json = await srFetch<Resp>(`/courier/generate/pickup`, {
        method: "POST",
        body: JSON.stringify({ shipment_id: [shipmentId] }),
    });
    return { status: json.response ?? (json.pickup_status != null ? String(json.pickup_status) : null) };
}

export async function shiprocketGenerateLabel(shipmentId: string): Promise<{ labelUrl: string | null }> {
    type Resp = { label_created?: number; label_url?: string };
    const json = await srFetch<Resp>(`/courier/generate/label`, {
        method: "POST",
        body: JSON.stringify({ shipment_id: [shipmentId] }),
    });
    return { labelUrl: json.label_url ?? null };
}

/** Generate + print the pickup manifest for a booked shipment — the sheet the
 *  courier's pickup agent signs at handover. Generate is best-effort (it fails
 *  once a manifest already exists); print returns the PDF URL either way. */
export async function shiprocketPrintManifest(
    shipmentId: string,
    srOrderId: string,
): Promise<{ manifestUrl: string | null }> {
    await srFetch(`/manifests/generate`, {
        method: "POST",
        body: JSON.stringify({ shipment_id: [shipmentId] }),
    }).catch(() => undefined);
    type Resp = { manifest_url?: string };
    const json = await srFetch<Resp>(`/manifests/print`, {
        method: "POST",
        body: JSON.stringify({ order_ids: [srOrderId] }),
    });
    return { manifestUrl: json.manifest_url ?? null };
}

export type SrTracking = {
    currentStatus: string | null;
    currentStatusId: number | null;
    awb: string | null;
    courierName: string | null;
};

export async function shiprocketTrackByAwb(awb: string): Promise<SrTracking> {
    type Resp = {
        tracking_data?: {
            shipment_status?: number;
            shipment_track?: Array<{ current_status?: string; courier_name?: string; awb_code?: string }>;
        };
    };
    const json = await srFetch<Resp>(`/courier/track/awb/${encodeURIComponent(awb)}`, { method: "GET" });
    const track = json.tracking_data?.shipment_track?.[0];
    return {
        currentStatus: track?.current_status ?? null,
        currentStatusId: json.tracking_data?.shipment_status ?? null,
        awb: track?.awb_code ?? awb,
        courierName: track?.courier_name ?? null,
    };
}
