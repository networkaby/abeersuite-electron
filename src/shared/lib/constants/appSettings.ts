/**
 * Settings → App Settings: low-sensitivity values the owner may keep in the
 * database instead of .env / Vercel. Each key's name IS its .env name, so the
 * fallback needs no mapping: DB value → process.env[key] → `fallback`.
 *
 * Secrets too (owner, 2026-11-12): a token or password may be saved here for
 * testing without a deploy, then moved to Vercel and cleared from here. A
 * `secret` key is never sent back to the browser — only its last 4 characters.
 * Client-safe — the form imports it.
 */

export type AppSettingDef = {
    key: string;
    label: string;
    group: "WhatsApp" | "Meta app" | "Couriers" | "Payments" | "Email & SMS";
    hint: string;
    /** Allowed values — the form shows a dropdown. */
    options?: readonly string[];
    /** Digits only (Meta ids). */
    numeric?: boolean;
    /** Token / password: write-only on screen, masked in the API. */
    secret?: boolean;
};

export const APP_SETTING_DEFS = [
    { key: "META_WA_PHONE_NUMBER_ID", label: "OTP number (Phone number ID)", group: "WhatsApp", numeric: true,
      hint: "Login codes go from this number. WhatsApp Manager → Phone numbers → click the number." },
    { key: "WA_CONVERSATION_NUMBER_ID", label: "Bills & replies number (Phone number ID)", group: "WhatsApp", numeric: true,
      hint: "Bills, reminders and new staff replies go from this number. Blank = the OTP number. Pick only a Connected number, or every bill fails." },
    { key: "META_WA_BUSINESS_ACCOUNT_ID", label: "WhatsApp Business Account ID", group: "WhatsApp", numeric: true,
      hint: "The account both numbers sit in; templates are sent for approval here." },
    { key: "WA_OTP_TEMPLATE", label: "OTP template name", group: "WhatsApp",
      hint: "Name of the approved AUTHENTICATION template." },
    { key: "WA_OTP_LANG", label: "OTP template language", group: "WhatsApp",
      hint: "Language code of that template; blank = en." },
    { key: "WA_OTP_BUTTON", label: "OTP template button", group: "WhatsApp", options: ["none", "copy_code", "one_tap"],
      hint: "copy_code for a website login; none if the template has no button." },
    { key: "META_WA_SIGNUP_CONFIG_ID", label: "Connect-number setup ID", group: "WhatsApp", numeric: true,
      hint: "Embedded Signup configuration used by the Connect number button." },
    { key: "META_APP_ID", label: "Meta app ID", group: "Meta app", numeric: true,
      hint: "The Meta app (loginapi)." },
    { key: "META_APP_SECRET", label: "Meta app secret", group: "Meta app", secret: true,
      hint: "Meta app → App settings → Basic → App secret. Used for Facebook / Instagram connect." },
    { key: "META_WA_ACCESS_TOKEN", label: "WhatsApp access token", group: "WhatsApp", secret: true,
      hint: "System-user token with whatsapp_business_messaging + management." },
    { key: "SHIPROCKET_EMAIL", label: "Shiprocket API user email", group: "Couriers",
      hint: "Shiprocket → Settings → API → API user." },
    { key: "SHIPROCKET_PASSWORD", label: "Shiprocket API user password", group: "Couriers", secret: true,
      hint: "Password of that API user." },
    { key: "SHIPWAY_USERNAME", label: "Shipway account email", group: "Couriers",
      hint: "Login email of the Shipway account." },
    { key: "SHIPWAY_LICENSE", label: "Shipway licence key", group: "Couriers", secret: true,
      hint: "Shipway → Profile → Manage profile → License Key." },
    { key: "CASHFREE_APP_ID", label: "Cashfree app ID", group: "Payments",
      hint: "Cashfree → Developers → API keys." },
    { key: "CASHFREE_SECRET_KEY", label: "Cashfree secret key", group: "Payments", secret: true,
      hint: "The secret shown with that app ID." },
    { key: "PAYU_MERCHANT_KEY", label: "PayU merchant key", group: "Payments",
      hint: "PayU dashboard → Developers → Key and salt." },
    { key: "PAYU_MERCHANT_SALT", label: "PayU merchant salt", group: "Payments", secret: true,
      hint: "The salt shown with that key." },
    { key: "EMAIL_FROM", label: "Email sender", group: "Email & SMS",
      hint: "From address on emails, e.g. Network Service <no-reply@networkservice.in>." },
    { key: "RESEND_API_KEY", label: "Resend API key", group: "Email & SMS", secret: true,
      hint: "resend.com → API keys." },
    { key: "HANU_OTP_TEMPLATE_ID", label: "SMS OTP template ID", group: "Email & SMS",
      hint: "HanuOTP template for login codes; blank = default." },
] as const satisfies readonly AppSettingDef[];

export type AppSettingKey = (typeof APP_SETTING_DEFS)[number]["key"];
export type AppSettingValues = Partial<Record<AppSettingKey, string>>;

const KEYS = new Set<string>(APP_SETTING_DEFS.map((d) => d.key));

/** Keep only known keys with a non-blank trimmed string. */
export function normalizeAppSettings(raw: unknown): AppSettingValues {
    const out: AppSettingValues = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (KEYS.has(k) && typeof v === "string" && v.trim()) out[k as AppSettingKey] = v.trim();
    }
    return out;
}

export const SECRET_APP_SETTING_KEYS = new Set<string>(
    APP_SETTING_DEFS.filter((d) => "secret" in d && d.secret).map((d) => d.key),
);

/** What the screen may show of a secret: its last 4 characters. */
export const maskSecret = (v: string) => (v ? `…${v.slice(-4)}` : "");
