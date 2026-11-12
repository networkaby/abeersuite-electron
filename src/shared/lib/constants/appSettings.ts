/**
 * Settings → App Settings: low-sensitivity values the owner may keep in the
 * database instead of .env / Vercel. Each key's name IS its .env name, so the
 * fallback needs no mapping: DB value → process.env[key] → `fallback`.
 *
 * Owner's rule (2026-11-12): secrets (tokens, app secrets, passwords) stay in
 * Vercel and never appear here; ids and plain choices may live in the DB.
 * Client-safe — the form imports it.
 */

export type AppSettingDef = {
    key: string;
    label: string;
    group: "WhatsApp" | "Meta app";
    hint: string;
    /** Allowed values — the form shows a dropdown. */
    options?: readonly string[];
    /** Digits only (Meta ids). */
    numeric?: boolean;
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
      hint: "The Meta app (loginapi). Its secret stays in Vercel." },
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
