import "server-only";

/**
 * SMS OTP delivery through HanuOTP's "OTP Without DLT" route — Rs 0.30 per
 * code on their smallest plan, sent on their own template, so we need no DLT
 * registration of our own.
 *
 * Fast2SMS was removed 2026-10-06: without our own DLT its only route was
 * ~Rs 5 per SMS. The send route, the "check your texts" screen and the SMS
 * icon already handle `via: "sms"`.
 *
 * Like WhatsApp, the vendor is a pipe: we generate the code and verify it
 * ourselves (see `otpChallenge.ts`).
 */

const HANU_OTP_URL = "https://api.hanuotp.in/sms-otp.php";

export class SmsNotConfiguredError extends Error {
    constructor(detail = "no SMS provider") {
        super(`SMS sending is not set up yet (${detail}).`);
        this.name = "SmsNotConfiguredError";
    }
}

/** The key, or undefined while `.env` still holds the example placeholder. */
function apiKey(): string | undefined {
    const key = process.env.HANU_OTP_API_KEY?.trim();
    return key && !key.startsWith("your-") ? key : undefined;
}

export function isSmsConfigured(): boolean {
    return Boolean(apiKey());
}

/** Send a pre-generated OTP by SMS to a bare 10-digit Indian mobile number. */
export async function sendOtpSms(mobile: string, code: string): Promise<void> {
    const key = apiKey();
    if (!key) throw new SmsNotConfiguredError("HANU_OTP_API_KEY missing");

    const url = new URL(HANU_OTP_URL);
    url.searchParams.set("number", mobile);
    url.searchParams.set("OTP", code);
    url.searchParams.set("apikey", key);
    url.searchParams.set("templatesid", process.env.HANU_OTP_TEMPLATE_ID?.trim() || "default");

    const res = await fetch(url, { cache: "no-store" });
    const body = await res.text();
    // HanuOTP does not document its reply, so treat anything that reads like a
    // refusal as one — a silent "sent" that never arrives is worse than an error.
    if (!res.ok || /error|fail|invalid|insufficient|false/i.test(body)) {
        throw new Error(`HanuOTP send failed (${res.status}): ${body.slice(0, 200)}`);
    }
}
