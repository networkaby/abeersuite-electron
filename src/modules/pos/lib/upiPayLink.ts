import "server-only";
import { DEFAULT_PAYEE_NAME, upiProvider } from "./paymentLink";

/**
 * The "Pay now" link a UPI payment request carries. Meta allows only https in a
 * WhatsApp button, so the button opens /portal/b/<code>, and that page hands the
 * phone on to upi://pay. The same code + /qr is the template's photo header.
 *
 * Plain, like a bill's /portal/b/<id>: the code holds VPA, amount and note and
 * nothing else, so the office, the shop site and every counter read it alike
 * (an earlier signed form broke whenever their AUTH_SECRETs differed — Meta
 * could not fetch the photo and dropped the message). Shape: p<base64url(json)>
 * — an old p<payload>.<sig> link still opens; the part after the dot is ignored.
 */

export type UpiPayRequest = { vpa: string; amount: number; note: string };

const PREFIX = "p";

export function encodeUpiPayCode(r: UpiPayRequest): string {
    return PREFIX + Buffer.from(JSON.stringify({ v: r.vpa, a: Number(r.amount.toFixed(2)), n: r.note })).toString("base64url");
}

export function isUpiPayCode(code: string): boolean {
    return code.startsWith(PREFIX) && code.length > 8;
}

/** null when the code is not a readable pay request. */
export function decodeUpiPayCode(code: string): UpiPayRequest | null {
    if (!isUpiPayCode(code)) return null;
    const payload = code.slice(PREFIX.length).split(".")[0];
    try {
        const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: unknown; a?: unknown; n?: unknown };
        if (typeof j.v !== "string" || !/^[\w.\-]+@[\w.\-]+$/.test(j.v)) return null;
        if (typeof j.a !== "number" || !(j.a > 0)) return null;
        return { vpa: j.v, amount: j.a, note: typeof j.n === "string" ? j.n.slice(0, 60) : "" };
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
