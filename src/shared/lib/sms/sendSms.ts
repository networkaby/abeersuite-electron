import "server-only";

/**
 * SMS OTP delivery — the fallback when Meta WhatsApp cannot reach a customer.
 * Neither provider needs DLT registration of our own. `SMS_OTP_PROVIDER` picks
 * one (`hanuotp` | `minimoth` | `off`), so the owner can switch after a trial
 * without a code change.
 *
 *   - HanuOTP: a pipe. We generate the code and verify it ourselves
 *     (see `otpChallenge.ts`). ~Rs 0.30 per code.
 *   - MiniMoth: generates its own code, so only MiniMoth can verify it — the
 *     pending cookie records that, and `verifyOtpSms` asks them. Rs 0.35 per
 *     code, refunded when undelivered. It tries its own WhatsApp first, but we
 *     only call it after Meta WhatsApp has already failed.
 *
 * Fast2SMS was removed 2026-10-06: without our own DLT its only route was
 * ~Rs 5 per SMS.
 */

type SmsProvider = "hanuotp" | "minimoth";

const HANU_OTP_URL = "https://api.hanuotp.in/sms-otp.php";
const MINIMOTH_URL = "https://api.minimoth.dev/v1/otp";

export class SmsNotConfiguredError extends Error {
    constructor(detail = "no SMS provider") {
        super(`SMS sending is not set up yet (${detail}).`);
        this.name = "SmsNotConfiguredError";
    }
}

/** An env value, or undefined while it is blank or still the `your-…` placeholder. */
function envKey(name: string): string | undefined {
    const v = process.env[name]?.trim();
    return v && !v.startsWith("your-") ? v : undefined;
}

const KEY_ENV: Record<SmsProvider, string> = {
    hanuotp: "HANU_OTP_API_KEY",
    minimoth: "MINIMOTH_API_KEY",
};

/** The chosen provider, only when its key is filled in. */
function activeProvider(): { provider: SmsProvider; key: string } | null {
    const choice = (process.env.SMS_OTP_PROVIDER || "hanuotp").trim().toLowerCase();
    if (choice !== "hanuotp" && choice !== "minimoth") return null;
    const key = envKey(KEY_ENV[choice]);
    return key ? { provider: choice, key } : null;
}

export function isSmsConfigured(): boolean {
    return activeProvider() !== null;
}

/**
 * Send an OTP by SMS to a bare 10-digit Indian mobile number. Returns
 * `"remote"` when the provider made and holds its own code (MiniMoth) — then
 * `code` was not sent and the caller must verify through `verifyOtpSms`.
 */
export async function sendOtpSms(mobile: string, code: string): Promise<"local" | "remote"> {
    const active = activeProvider();
    if (!active) throw new SmsNotConfiguredError(`SMS_OTP_PROVIDER key missing`);

    if (active.provider === "minimoth") {
        const res = await fetch(`${MINIMOTH_URL}/send`, {
            method: "POST",
            headers: { "X-Api-Key": active.key, "Content-Type": "application/json" },
            body: JSON.stringify({ phone: mobile }),
            cache: "no-store",
        });
        if (!res.ok) {
            throw new Error(`MiniMoth send failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
        }
        return "remote";
    }

    const url = new URL(HANU_OTP_URL);
    url.searchParams.set("number", mobile);
    url.searchParams.set("OTP", code);
    url.searchParams.set("apikey", active.key);
    url.searchParams.set("templatesid", process.env.HANU_OTP_TEMPLATE_ID?.trim() || "default");

    const res = await fetch(url, { cache: "no-store" });
    const body = await res.text();
    // HanuOTP does not document its reply, so treat anything that reads like a
    // refusal as one — a silent "sent" that never arrives is worse than an error.
    if (!res.ok || /error|fail|invalid|insufficient|false/i.test(body)) {
        throw new Error(`HanuOTP send failed (${res.status}): ${body.slice(0, 200)}`);
    }
    return "local";
}

/**
 * Ask MiniMoth whether a typed code matches the one it sent. Uses the key at
 * hand even if `SMS_OTP_PROVIDER` was switched since the send. Their session
 * tokens are ignored — we only want the yes/no and keep our own sign-in.
 */
export async function verifyOtpSms(mobile: string, code: string): Promise<boolean> {
    const key = envKey(KEY_ENV.minimoth);
    if (!key) throw new SmsNotConfiguredError("MINIMOTH_API_KEY missing");
    const res = await fetch(`${MINIMOTH_URL}/verify`, {
        method: "POST",
        headers: { "X-Api-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: mobile, code }),
        cache: "no-store",
    });
    if (res.ok) return true;
    // 4xx = wrong / expired / unknown code; anything else is their outage.
    if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403) return false;
    throw new Error(`MiniMoth verify failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
