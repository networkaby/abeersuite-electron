// SERVER-ONLY. Cashfree PG (v3) helpers: create an order + read its status. Reads
// CASHFREE_APP_ID / CASHFREE_SECRET_KEY. Secrets never leave the server — the browser
// only gets the payment_session_id, which the Cashfree JS SDK uses to launch checkout.

export type CashfreeEnv = "TEST" | "LIVE";

const BASE: Record<CashfreeEnv, string> = {
    TEST: "https://sandbox.cashfree.com/pg",
    LIVE: "https://api.cashfree.com/pg",
};
const API_VERSION = "2023-08-01";

/** SDK mode string for the given environment. */
export function cashfreeMode(env: CashfreeEnv): "sandbox" | "production" {
    return env === "LIVE" ? "production" : "sandbox";
}

export function cashfreeCreds(): { appId: string; secret: string } | null {
    const appId = process.env.CASHFREE_APP_ID?.trim();
    const secret = process.env.CASHFREE_SECRET_KEY?.trim();
    if (!appId || !secret) return null;
    return { appId, secret };
}

function headers(creds: { appId: string; secret: string }): HeadersInit {
    return {
        "x-client-id": creds.appId,
        "x-client-secret": creds.secret,
        "x-api-version": API_VERSION,
        "Content-Type": "application/json",
    };
}

export type CreateCashfreeOrderArgs = {
    orderId: string;
    amountRupees: number;
    customerId: string;
    customerPhone: string;
    customerName: string;
    customerEmail: string;
    returnUrl: string;
};

/** Create a Cashfree order; returns the payment_session_id, or an error message. */
export async function createCashfreeOrder(
    env: CashfreeEnv,
    creds: { appId: string; secret: string },
    args: CreateCashfreeOrderArgs,
): Promise<{ paymentSessionId: string } | { error: string }> {
    const res = await fetch(`${BASE[env]}/orders`, {
        method: "POST",
        headers: headers(creds),
        body: JSON.stringify({
            order_id: args.orderId,
            order_amount: args.amountRupees,
            order_currency: "INR",
            customer_details: {
                customer_id: args.customerId,
                customer_phone: args.customerPhone,
                customer_name: args.customerName,
                customer_email: args.customerEmail,
            },
            order_meta: { return_url: args.returnUrl },
        }),
    });
    const data = (await res.json().catch(() => ({}))) as {
        payment_session_id?: string;
        message?: string;
    };
    if (!res.ok || !data.payment_session_id) {
        return { error: data.message || `Cashfree order failed (${res.status})` };
    }
    return { paymentSessionId: data.payment_session_id };
}

/** Read a Cashfree order's status + amount (for server-side confirmation). */
export async function getCashfreeOrder(
    env: CashfreeEnv,
    creds: { appId: string; secret: string },
    orderId: string,
): Promise<{ status: string; amount: number } | null> {
    const res = await fetch(`${BASE[env]}/orders/${encodeURIComponent(orderId)}`, {
        headers: headers(creds),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as {
        order_status?: string;
        order_amount?: number;
    };
    if (!data.order_status) return null;
    return { status: data.order_status, amount: Number(data.order_amount ?? 0) };
}
