// SERVER-ONLY. Pine Labs Online (Plural) hosted checkout: sign in with the client
// id + secret, create a checkout link (the customer pays on Pine Labs' page), and
// read the order back to confirm it — the return to our site is never trusted.
// Keys: PINELABS_CLIENT_ID / PINELABS_CLIENT_SECRET (Settings → App Settings, else .env).
//
// Docs (2026-11-13): https://www.pinelabs.com/docs/online-payments/api
//   POST {base}/api/auth/v1/token          → access_token, expires_at
//   POST {base}/api/checkout/v1/orders     → order_id, redirect_url
//   GET  {base}/api/pay/v1/orders/{id}     → data.status, data.order_amount
// UNCONFIRMED until the first UAT payment: amounts in paise (examples use 50000 /
// 1100), the live host (api.pluralpay.in, seen only in an example), and which status
// means paid (PROCESSED assumed). Keep the gateway on TEST until those check out.

import crypto from "crypto";
import { appSetting } from "@/shared/lib/settings/appSettings.server";

export type PineLabsEnv = "TEST" | "LIVE";

const BASE: Record<PineLabsEnv, string> = {
    TEST: "https://pluraluat.v2.pinepg.in",
    LIVE: "https://api.pluralpay.in",
};

/** The statuses that mean the money is taken. */
const PAID = new Set(["PROCESSED", "SETTLED"]);

export async function pineLabsCreds(): Promise<{ clientId: string; clientSecret: string } | null> {
    const clientId = await appSetting("PINELABS_CLIENT_ID");
    const clientSecret = await appSetting("PINELABS_CLIENT_SECRET");
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
}

/** Every Pine Labs call carries a fresh request id + UTC timestamp. */
const requestHeaders = (): Record<string, string> => ({
    "Content-Type": "application/json",
    "Request-ID": crypto.randomUUID(),
    "Request-Timestamp": new Date().toISOString(),
});

// One token per environment + client id, reused until a minute before it expires.
const tokens = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(env: PineLabsEnv, creds: { clientId: string; clientSecret: string }): Promise<string> {
    const cacheKey = `${env}:${creds.clientId}`;
    const hit = tokens.get(cacheKey);
    if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;

    const res = await fetch(`${BASE[env]}/api/auth/v1/token`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "client_credentials" }),
        cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_at?: string; message?: string };
    if (!res.ok || !data.access_token) {
        tokens.delete(cacheKey);
        throw new Error(data.message || `Pine Labs sign-in failed (${res.status})`);
    }
    const expiresAt = data.expires_at ? Date.parse(data.expires_at) : Date.now() + 10 * 60_000;
    tokens.set(cacheKey, { token: data.access_token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 10 * 60_000 });
    return data.access_token;
}

export type CreatePineLabsCheckoutArgs = {
    /** Our reference — unique per attempt (max 50). */
    reference: string;
    amountPaise: number;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    callbackUrl: string;
};

/** Create a hosted checkout; returns Pine Labs' order id + the page to send the customer to. */
export async function createPineLabsCheckout(
    env: PineLabsEnv,
    creds: { clientId: string; clientSecret: string },
    args: CreatePineLabsCheckoutArgs,
): Promise<{ orderId: string; redirectUrl: string } | { error: string }> {
    try {
        const token = await accessToken(env, creds);
        const [first, ...rest] = args.customerName.trim().split(/\s+/u);
        const res = await fetch(`${BASE[env]}/api/checkout/v1/orders`, {
            method: "POST",
            headers: { ...requestHeaders(), Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                merchant_order_reference: args.reference.slice(0, 50),
                order_amount: { value: Math.round(args.amountPaise), currency: "INR" },
                integration_mode: "REDIRECT",
                pre_auth: false,
                callback_url: args.callbackUrl,
                failure_callback_url: args.callbackUrl,
                purchase_details: {
                    customer: {
                        email_id: args.customerEmail,
                        first_name: first || "Customer",
                        last_name: rest.join(" "),
                        mobile_number: args.customerPhone,
                        country_code: "91",
                    },
                },
            }),
            cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
            order_id?: string;
            redirect_url?: string;
            response_message?: string;
            message?: string;
        };
        if (!res.ok || !data.order_id || !data.redirect_url) {
            return { error: data.response_message || data.message || `Pine Labs checkout failed (${res.status})` };
        }
        return { orderId: data.order_id, redirectUrl: data.redirect_url };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}

/** Read a Pine Labs order back. `paid` is true only for a status that means the money is taken. */
export async function getPineLabsOrder(
    env: PineLabsEnv,
    creds: { clientId: string; clientSecret: string },
    orderId: string,
): Promise<{ status: string; paid: boolean; amountPaise: number } | null> {
    try {
        const token = await accessToken(env, creds);
        const res = await fetch(`${BASE[env]}/api/pay/v1/orders/${encodeURIComponent(orderId)}`, {
            headers: { ...requestHeaders(), Authorization: `Bearer ${token}` },
            cache: "no-store",
        });
        if (!res.ok) return null;
        const body = (await res.json().catch(() => ({}))) as {
            data?: { status?: string; order_amount?: { value?: number } };
        };
        const status = body.data?.status;
        if (!status) return null;
        return { status, paid: PAID.has(status), amountPaise: Number(body.data?.order_amount?.value ?? 0) };
    } catch {
        return null;
    }
}
