import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { DEFAULT_PAYEE_NAME, upiProvider } from "./paymentLink";

/**
 * The "Pay now" link a UPI payment request carries. Meta allows only https in a
 * WhatsApp button, so the button opens /portal/b/<code>, and that page hands the
 * phone on to upi://pay.
 *
 * The code holds everything the page needs — VPA, amount, note — signed with
 * AUTH_SECRET, so the page reads no DB and nobody can change the amount or the
 * payee in the link. Shape: p<base64url(json)>.<sig>
 */

export type UpiPayRequest = { vpa: string; amount: number; note: string };

const PREFIX = "p";

function sign(payload: string): string {
    const s = process.env.AUTH_SECRET;
    if (!s) throw new Error("AUTH_SECRET is not set — pay link cannot be signed.");
    return createHmac("sha256", s).update(`upi-pay:${payload}`).digest("base64url").slice(0, 22);
}

export function encodeUpiPayCode(r: UpiPayRequest): string {
    const payload = Buffer.from(JSON.stringify({ v: r.vpa, a: Number(r.amount.toFixed(2)), n: r.note })).toString("base64url");
    return `${PREFIX}${payload}.${sign(payload)}`;
}

export function isUpiPayCode(code: string): boolean {
    return code.startsWith(PREFIX) && code.includes(".");
}

/** null when the code is malformed or its signature does not match. */
export function decodeUpiPayCode(code: string): UpiPayRequest | null {
    if (!isUpiPayCode(code)) return null;
    const [payload, sig] = code.slice(PREFIX.length).split(".");
    if (!payload || !sig) return null;
    const want = Buffer.from(sign(payload));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
        const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: unknown; a?: unknown; n?: unknown };
        if (typeof j.v !== "string" || typeof j.a !== "number" || !(j.a > 0)) return null;
        return { vpa: j.v, amount: j.a, note: typeof j.n === "string" ? j.n : "" };
    } catch {
        return null;
    }
}

/** The upi://pay deep link — same builder the counter's QR uses. */
export function upiDeepLink(r: UpiPayRequest): string {
    return upiProvider.build(
        { upiVpa: r.vpa, payeeName: DEFAULT_PAYEE_NAME },
        { amountRupees: r.amount, note: r.note },
    );
}
