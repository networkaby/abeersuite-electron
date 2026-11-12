import "server-only";
import { appSetting } from "@/shared/lib/settings/appSettings.server";

/**
 * WhatsApp OTP delivery — the cheapest pipe for a mobile code.
 *
 * The vendor is a *pipe*: we generate the code and we decide whether it is
 * correct (see `otpChallenge.ts`) — Meta only delivers the message. That is
 * why every OTP channel shares one expiry, one attempt budget and one verify
 * path.
 *
 * We are Meta's own customer (Cloud API, graph.facebook.com, `Bearer <system-
 * user token>`): ~Rs 0.115 per authentication message in India, no monthly
 * fee, and undelivered messages are not billed. The Fast2SMS passthrough was
 * removed 2026-10-06.
 *
 * ── Setup (see docs/portal-passwordless-setup.md) ───────────────────────────
 *   META_WA_ACCESS_TOKEN        permanent system-user token (Vercel only)
 *   The four below may also be set on Settings → App Settings, which wins.
 *   META_WA_PHONE_NUMBER_ID     from the Meta app dashboard
 *   WA_OTP_TEMPLATE             approved AUTHENTICATION template *name*
 *   WA_OTP_LANG                 template language, default "en"
 *   WA_OTP_BUTTON               "copy_code" / "one_tap" if the template has a
 *                               button (it then needs the code twice)
 *
 * Meta's authentication templates carry no free text: the body is fixed
 * boilerplate and the code is the only variable. So there is nothing to word
 * here.
 */

/** Meta Cloud API version we target. */
const GRAPH_VERSION = "v21.0";

const phoneNumberId = () => appSetting("META_WA_PHONE_NUMBER_ID");
const templateName = () => appSetting("WA_OTP_TEMPLATE");
const templateLang = async () => (await appSetting("WA_OTP_LANG")) || "en";
/**
 * Which button the approved template has, if any — these are NOT
 * interchangeable at template-creation time, but both send the same payload:
 *   "copy_code"  → sent as a `url` button with the code as text (Meta requires it).
 *                  This is the one to use for a website login (no Android app).
 *   "one_tap"    → button parameter is `{ type: "text", text }` (autofills into
 *                  a native Android app via the SMS Retriever API — needs the
 *                  app's package name + signature hash at template-creation time,
 *                  which a web-only template never has).
 *   "none"       → plain authentication template, body only, no button.
 */
type OtpButtonKind = "copy_code" | "one_tap" | "none";

async function templateButtonKind(): Promise<OtpButtonKind> {
    const raw = ((await appSetting("WA_OTP_BUTTON")) || "").toLowerCase();
    if (raw === "one_tap" || raw === "url") return "one_tap";
    // Legacy "1" meant "has some button" — copy_code is the correct default
    // for a website, and is what the template wizard calls "Copy code".
    if (raw === "1" || raw === "copy_code") return "copy_code";
    return "none";
}

export class WhatsAppNotConfiguredError extends Error {
    constructor(detail = "phone number id missing") {
        super(`WhatsApp sending is not set up yet (${detail}).`);
        this.name = "WhatsAppNotConfiguredError";
    }
}

export async function isWhatsAppConfigured(): Promise<boolean> {
    return Boolean((await appSetting("META_WA_ACCESS_TOKEN")) && (await phoneNumberId()) && (await templateName()));
}

/**
 * Send a pre-generated OTP over WhatsApp to a 10-digit Indian mobile number.
 * `mobile` must be exactly 10 digits — no +91, no spaces; we add the country
 * code because Meta always wants the number in full international form.
 */
export async function sendOtpWhatsApp(mobile: string, code: string): Promise<void> {
    const numberId = await phoneNumberId();
    const template = await templateName();
    const metaToken = await appSetting("META_WA_ACCESS_TOKEN");

    if (!numberId) throw new WhatsAppNotConfiguredError();
    if (!template) throw new WhatsAppNotConfiguredError("WA_OTP_TEMPLATE missing");
    if (!metaToken) throw new WhatsAppNotConfiguredError("META_WA_ACCESS_TOKEN missing");
    if (!/^[0-9]{10}$/.test(mobile)) {
        throw new Error(`WhatsApp needs a bare 10-digit number, got "${mobile}"`);
    }

    // Copy-code and one-tap templates repeat the code in the button payload,
    // in the same url-button shape; a plain authentication template has
    // a body parameter only.
    const components: unknown[] = [{ type: "body", parameters: [{ type: "text", text: code }] }];
    const buttonKind = await templateButtonKind();
    // Meta sends BOTH button kinds of an authentication template as a "url"
    // button carrying the code as text — a `copy_code`/`coupon_code` shape is
    // refused with 132018 "Button at index 0 must be of type Url" (2026-10-06).
    if (buttonKind !== "none") {
        components.push({
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: code }],
        });
    }

    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${numberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${metaToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: `+91${mobile}`,
            type: "template",
            template: {
                name: template,
                language: { code: await templateLang() },
                components,
            },
        }),
    });

    // Meta answers 200 with a message id on success and an `error` object on
    // failure — so status alone is not enough.
    const bodyText = await res.text().catch(() => "");
    let parsed: {
        messages?: { id?: string }[];
        error?: { message?: string };
    } | null = null;
    try {
        parsed = JSON.parse(bodyText);
    } catch {
        /* non-JSON body — fall through to the status check */
    }

    const delivered = Boolean(parsed?.messages?.[0]?.id);
    if (!res.ok || !delivered) {
        const detail = parsed?.error?.message || bodyText.slice(0, 300);
        // Vendor reason goes to logs only — never to the customer.
        throw new Error(
            `WhatsApp send failed (${res.status}): ${detail}`
        );
    }
}
