import "server-only";

/**
 * SMS OTP delivery — the fallback when Meta WhatsApp cannot reach a customer.
 * Neither provider needs DLT registration of our own. Every provider whose
 * key is filled in is on (blank / `your-…` placeholder = off, never tried);
 * both keep a balance, so they take turns: SMS try N starts at provider N, and
 * a failure moves straight on to the next one.
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

/** Fixed order — the rotation and the failover both walk this list. */
const ORDER: SmsProvider[] = ["minimoth", "hanuotp"];

/** Providers with a real key, in order. */
function activeProviders(): { provider: SmsProvider; key: string }[] {
    return ORDER.flatMap((provider) => {
        const key = envKey(KEY_ENV[provider]);
        return key ? [{ provider, key }] : [];
    });
}

export function isSmsConfigured(): boolean {
    return activeProviders().length > 0;
}

/**
 * Send an OTP by SMS to a bare 10-digit Indian mobile number, starting at
 * provider `smsTry` (mod the number that are on) and falling through the rest
 * on failure. Returns `"remote"` when the provider that delivered made and
 * holds its own code (MiniMoth) — then the caller must verify through
 * `verifyOtpSms`.
 */
export async function sendOtpSms(mobile: string, code: string, smsTry = 0): Promise<"local" | "remote"> {
    const active = activeProviders();
    if (active.length === 0) throw new SmsNotConfiguredError("no SMS provider key set");
    const start = Math.abs(Math.trunc(smsTry)) % active.length;
    let lastError: unknown;
    for (let i = 0; i < active.length; i++) {
        const { provider, key } = active[(start + i) % active.length];
        try {
            return await sendVia(provider, key, mobile, code);
        } catch (e) {
            console.error(`SMS OTP via ${provider} failed:`, e);
            lastError = e;
        }
    }
    throw lastError;
}

async function sendVia(
    provider: SmsProvider,
    key: string,
    mobile: string,
    code: string
): Promise<"local" | "remote"> {
    if (provider === "minimoth") {
        const res = await fetch(`${MINIMOTH_URL}/send`, {
            method: "POST",
            headers: { "X-Api-Key": key, "Content-Type": "application/json" },
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
    url.searchParams.set("apikey", key);
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
 * hand even if the key was blanked since the send (then this throws). Their session
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
