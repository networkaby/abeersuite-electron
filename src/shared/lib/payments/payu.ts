// SERVER-ONLY. PayU (India) hosted-checkout helpers: endpoint selection + the
// SHA-512 request/response hashes. Reads PAYU_MERCHANT_KEY / PAYU_MERCHANT_SALT.
// Secrets never leave the server — the browser only ever gets the signed field set.
//
// PayU is a hosted redirect: we sign a field set, the customer's browser POSTs it
// to PayU's _payment page, pays, and PayU POSTs back to our callback with a `hash`
// we re-compute (the "reverse" sequence) to prove the result is genuine.

import { createHash } from "crypto";

export type PayuEnv = "TEST" | "LIVE";

const ENDPOINTS: Record<PayuEnv, string> = {
    TEST: "https://test.payu.in/_payment",
    LIVE: "https://secure.payu.in/_payment",
};

export function payuEndpoint(env: PayuEnv): string {
    return ENDPOINTS[env] ?? ENDPOINTS.TEST;
}

/** Merchant key + salt from env, or null when either is missing. */
export function payuCreds(): { key: string; salt: string } | null {
    const key = process.env.PAYU_MERCHANT_KEY?.trim();
    const salt = process.env.PAYU_MERCHANT_SALT?.trim();
    if (!key || !salt) return null;
    return { key, salt };
}

const sha512 = (s: string) => createHash("sha512").update(s).digest("hex");

/** Amount the way PayU wants it: rupees, exactly 2 decimals. */
export function payuAmount(paise: number): string {
    return (Math.max(0, Math.round(paise)) / 100).toFixed(2);
}

export type PayuRequestFields = {
    key: string;
    txnid: string;
    amount: string;
    productinfo: string;
    firstname: string;
    email: string;
    phone: string;
    surl: string;
    furl: string;
    hash: string;
};

/**
 * Build the signed field set for the PayU `_payment` form POST. UDFs are unused.
 * Request hash sequence:
 *   key|txnid|amount|productinfo|firstname|email|udf1..udf5|<5 reserved>|SALT
 * (all 10 middle fields empty here).
 */
export function buildPayuRequest(args: {
    key: string;
    salt: string;
    txnid: string;
    amount: string;
    productinfo: string;
    firstname: string;
    email: string;
    phone: string;
    surl: string;
    furl: string;
}): PayuRequestFields {
    const { key, salt, txnid, amount, productinfo, firstname, email, phone, surl, furl } = args;
    const hash = sha512(
        [key, txnid, amount, productinfo, firstname, email,
            "", "", "", "", "", "", "", "", "", "", // udf1-5 + 5 reserved
            salt].join("|"),
    );
    return { key, txnid, amount, productinfo, firstname, email, phone, surl, furl, hash };
}

/**
 * Verify PayU's response POST hash. Reverse sequence:
 *   [additionalCharges|]SALT|status|<10 reserved/udf>|email|firstname|productinfo|amount|txnid|key
 * Returns true only when the recomputed hash matches the posted one.
 */
export function verifyPayuResponse(salt: string, body: Record<string, string>): boolean {
    const posted = (body.hash ?? "").toLowerCase();
    if (!posted) return false;
    const base = [
        salt,
        body.status ?? "",
        "", "", "", "", "", "", "", "", "", "", // reverse of the 10 empty udf/reserved fields
        body.email ?? "",
        body.firstname ?? "",
        body.productinfo ?? "",
        body.amount ?? "",
        body.txnid ?? "",
        body.key ?? "",
    ];
    // When PayU levies additional charges it prepends that value to the sequence.
    const add = body.additionalCharges?.trim();
    const expected = add ? sha512([add, ...base].join("|")) : sha512(base.join("|"));
    return expected.toLowerCase() === posted;
}
