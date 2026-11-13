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

export const APP_SETTING_SECTIONS = ["Messaging", "Social & Google", "Files & media", "Couriers", "Payments", "Email & SMS"] as const;
export type AppSettingSection = (typeof APP_SETTING_SECTIONS)[number];

export type AppSettingDef = {
    key: string;
    label: string;
    /** Page heading — what it is for. */
    section: AppSettingSection;
    /** Card inside the section — whose key it is. */
    provider: string;
    /** WhatsApp card only: ① Number 1 (OTP), ② Number 2 (bills), or the shared connection. */
    group?: "n1" | "n2" | "conn";
    /** Not needed for the provider to work (the card's Ready check skips it). */
    optional?: boolean;
    hint: string;
    /** Allowed values — the form shows a dropdown. */
    options?: readonly string[];
    /** Digits only (Meta ids). */
    numeric?: boolean;
    /** Token / password: write-only on screen, masked in the API. */
    secret?: boolean;
};

export const APP_SETTING_DEFS = [
    { key: "META_WA_PHONE_NUMBER_ID", label: "Phone number ID", group: "n1", section: "Messaging", provider: "WhatsApp (Meta Cloud API)", numeric: true,
      hint: "Login codes go from this number. WhatsApp Manager → Phone numbers → click the number." },
    { key: "META_WA_BUSINESS_ACCOUNT_ID", label: "WhatsApp account ID", group: "n1", section: "Messaging", provider: "WhatsApp (Meta Cloud API)", numeric: true,
      hint: "The WhatsApp Business account Number 1 sits in. Also Number 2's when Number 2 is in the same account." },
    { key: "WA_CONVERSATION_NUMBER_ID", label: "Phone number ID", group: "n2", section: "Messaging", provider: "WhatsApp (Meta Cloud API)", optional: true, numeric: true,
      hint: "Bills, reminders and new staff replies go from this number. Blank = Number 1. Pick only a Connected number, or every bill fails." },
    { key: "WA_CONVERSATION_BUSINESS_ACCOUNT_ID", label: "WhatsApp account ID", group: "n2", section: "Messaging", provider: "WhatsApp (Meta Cloud API)", optional: true, numeric: true,
      hint: "Only when Number 2 sits in another business's WhatsApp account. Bill templates are sent for approval there. Blank = Number 1's account." },
    { key: "WA_OTP_TEMPLATE", label: "Template name", section: "Messaging", provider: "WhatsApp login code (OTP template)",
      hint: "Name of the approved AUTHENTICATION template." },
    { key: "WA_OTP_LANG", label: "Language", section: "Messaging", provider: "WhatsApp login code (OTP template)", optional: true,
      hint: "Language code of that template; blank = en." },
    { key: "WA_OTP_BUTTON", label: "Button", section: "Messaging", provider: "WhatsApp login code (OTP template)", optional: true, options: ["none", "copy_code", "one_tap"],
      hint: "copy_code for a website login; none if the template has no button." },
    { key: "META_WA_SIGNUP_CONFIG_ID", label: "Connect-number setup ID", group: "conn", section: "Messaging", provider: "WhatsApp (Meta Cloud API)", optional: true, numeric: true,
      hint: "Embedded Signup configuration used by the Connect number button." },
    { key: "META_APP_ID", label: "App ID", section: "Messaging", provider: "Meta app (Facebook / Instagram connect)", numeric: true,
      hint: "The Meta app (loginapi)." },
    { key: "META_APP_SECRET", label: "App secret", section: "Messaging", provider: "Meta app (Facebook / Instagram connect)", secret: true,
      hint: "Meta app → App settings → Basic → App secret. Used for Facebook / Instagram connect." },
    { key: "FACEBOOK_REDIRECT_URL", label: "Facebook redirect URL", section: "Messaging", provider: "Meta app (Facebook / Instagram connect)", optional: true,
      hint: "Where Facebook sends staff back after Connect. Blank = office site /api/campaigns/facebook/callback. Must match Facebook Login's Valid OAuth Redirect URIs." },
    { key: "GOOGLE_BUSINESS_CLIENT_ID", label: "OAuth client ID", section: "Social & Google", provider: "Google Business Profile",
      hint: "Google Cloud → APIs & Services → Credentials → the OAuth client (Web application)." },
    { key: "GOOGLE_BUSINESS_CLIENT_SECRET", label: "OAuth client secret", section: "Social & Google", provider: "Google Business Profile", secret: true,
      hint: "The secret shown with that client ID." },
    { key: "GOOGLE_BUSINESS_REDIRECT_URL", label: "Redirect URL", section: "Social & Google", provider: "Google Business Profile", optional: true,
      hint: "Where Google sends staff back after Connect. Blank = office site /api/campaigns/google/callback. Must be in the OAuth client's Authorized redirect URIs." },
    { key: "META_WA_ACCESS_TOKEN", label: "Access token", group: "conn", section: "Messaging", provider: "WhatsApp (Meta Cloud API)", secret: true,
      hint: "System-user token with whatsapp_business_messaging + management." },
    { key: "CLOUDINARY_API_KEY", label: "API key", section: "Files & media", provider: "Cloudinary (photos)",
      hint: "Cloudinary console → Settings → API Keys. Signs photo uploads and runs photo clean-up. The cloud name stays in .env (NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) — keep both from the same account." },
    { key: "CLOUDINARY_API_SECRET", label: "API secret", section: "Files & media", provider: "Cloudinary (photos)", secret: true,
      hint: "The secret shown with that API key." },
    { key: "SHIPROCKET_EMAIL", label: "API user email", section: "Couriers", provider: "Shiprocket",
      hint: "Shiprocket → Settings → API → API user." },
    { key: "SHIPROCKET_PASSWORD", label: "API user password", section: "Couriers", provider: "Shiprocket", secret: true,
      hint: "Password of that API user." },
    { key: "SHIPWAY_USERNAME", label: "Account email", section: "Couriers", provider: "Shipway",
      hint: "Login email of the Shipway account." },
    { key: "SHIPWAY_LICENSE", label: "Licence key", section: "Couriers", provider: "Shipway", secret: true,
      hint: "Shipway → Profile → Manage profile → License Key." },
    { key: "RAZORPAY_KEY_ID", label: "Key ID", section: "Payments", provider: "Razorpay",
      hint: "Razorpay dashboard → Account & Settings → API keys. rzp_test_… for test, rzp_live_… for live." },
    { key: "RAZORPAY_KEY_SECRET", label: "Key secret", section: "Payments", provider: "Razorpay", secret: true,
      hint: "The secret shown once with that key ID." },
    { key: "CASHFREE_APP_ID", label: "App ID", section: "Payments", provider: "Cashfree",
      hint: "Cashfree → Developers → API keys." },
    { key: "CASHFREE_SECRET_KEY", label: "Secret key", section: "Payments", provider: "Cashfree", secret: true,
      hint: "The secret shown with that app ID." },
    { key: "PAYU_MERCHANT_KEY", label: "Merchant key", section: "Payments", provider: "PayU",
      hint: "PayU dashboard → Developers → Key and salt." },
    { key: "PAYU_MERCHANT_SALT", label: "Merchant salt", section: "Payments", provider: "PayU", secret: true,
      hint: "The salt shown with that key." },
    { key: "PINELABS_CLIENT_ID", label: "Client ID", section: "Payments", provider: "Pine Labs",
      hint: "Pine Labs dashboard → Settings → API Keys. Test and Live keys differ — match the gateway's mode." },
    { key: "PINELABS_CLIENT_SECRET", label: "Client secret", section: "Payments", provider: "Pine Labs", secret: true,
      hint: "The secret shown with that client ID." },
    { key: "EMAIL_FROM", label: "Email sender", section: "Email & SMS", provider: "Resend (email)",
      hint: "From address on emails, e.g. Network Service <no-reply@networkservice.in>." },
    { key: "RESEND_API_KEY", label: "API key", section: "Email & SMS", provider: "Resend (email)", secret: true,
      hint: "resend.com → API keys." },
    { key: "MINIMOTH_API_KEY", label: "API key", section: "Email & SMS", provider: "MiniMoth (SMS)", secret: true,
      hint: "minimoth.dev dashboard → API keys. Login codes by SMS when WhatsApp fails; MiniMoth makes and checks its own code." },
    { key: "HANU_OTP_API_KEY", label: "API key", section: "Email & SMS", provider: "HanuOTP (SMS)", secret: true,
      hint: "hanuotp.in → API key. Login codes by SMS when WhatsApp fails; takes turns with MiniMoth." },
    { key: "HANU_OTP_TEMPLATE_ID", label: "OTP template ID", section: "Email & SMS", provider: "HanuOTP (SMS)", optional: true,
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
