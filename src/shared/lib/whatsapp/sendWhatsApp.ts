import "server-only";

/**
 * WhatsApp OTP delivery — the cheapest pipe for a mobile code.
 *
 * Same deal as `sendSms.ts`: the vendor is a *pipe*. We generate the code and
 * we decide whether it is correct (see `otpChallenge.ts`) — the vendor only
 * hands the message to Meta. That is why mobile OTP over SMS and over WhatsApp
 * share one expiry, one attempt budget and one verify path.
 *
 * ── Two transports, same message ────────────────────────────────────────────
 * Both speak Meta's Cloud API schema, so only the URL and the auth header
 * differ:
 *
 *   DIRECT (preferred)  graph.facebook.com, `Bearer <system-user token>`.
 *                       You are Meta's customer: ~Rs 0.115 per authentication
 *                       message in India, no monthly fee, and undelivered
 *                       messages are not billed.
 *   PASSTHROUGH         Fast2SMS's WABA proxy, reusing FAST2SMS_API_KEY.
 *                       Convenient, but Fast2SMS is a BSP reselling Meta, so
 *                       its rate carries a markup over going direct.
 *
 * Direct wins whenever META_WA_ACCESS_TOKEN is set; otherwise we fall back to
 * the Fast2SMS passthrough so an existing setup keeps working.
 *
 * ── Setup (see docs/portal-passwordless-setup.md) ───────────────────────────
 *   META_WA_ACCESS_TOKEN        permanent system-user token  → direct mode
 *   META_WA_PHONE_NUMBER_ID     from the Meta app dashboard
 *   FAST2SMS_WA_PHONE_NUMBER_ID passthrough mode phone id
 *   WA_OTP_TEMPLATE             approved AUTHENTICATION template *name*
 *   WA_OTP_LANG                 template language, default "en"
 *   WA_OTP_BUTTON               "1" if the template has a copy-code /
 *                               one-tap button (it then needs the code twice)
 *
 * Meta's authentication templates carry no free text: the body is fixed
 * boilerplate and the code is the only variable. So there is nothing to word
 * here — unlike the SMS `q` route where we write the sentence ourselves.
 */

/** Meta Cloud API version we target. Both transports mirror this schema. */
const GRAPH_VERSION = "v21.0";

/** Direct = we are Meta's customer; passthrough = Fast2SMS resells to us. */
function isDirectMode(): boolean {
    return Boolean(process.env.META_WA_ACCESS_TOKEN && phoneNumberId());
}

function phoneNumberId(): string | undefined {
    return process.env.META_WA_PHONE_NUMBER_ID || process.env.FAST2SMS_WA_PHONE_NUMBER_ID;
}

/** Template settings are transport-independent; older FAST2SMS_* names still work. */
function templateName(): string | undefined {
    return process.env.WA_OTP_TEMPLATE || process.env.FAST2SMS_WA_OTP_TEMPLATE;
}
function templateLang(): string {
    return process.env.WA_OTP_LANG || process.env.FAST2SMS_WA_OTP_LANG || "en";
}
/**
 * Which button the approved template has, if any — these are NOT
 * interchangeable, Meta expects a different parameter shape for each:
 *   "copy_code"  → button parameter is `{ type: "coupon_code", coupon_code }`.
 *                  This is the one to use for a website login (no Android app).
 *   "one_tap"    → button parameter is `{ type: "text", text }` (autofills into
 *                  a native Android app via the SMS Retriever API — needs the
 *                  app's package name + signature hash at template-creation time,
 *                  which a web-only template never has).
 *   "none"       → plain authentication template, body only, no button.
 */
type OtpButtonKind = "copy_code" | "one_tap" | "none";

function templateButtonKind(): OtpButtonKind {
    const raw = (process.env.WA_OTP_BUTTON || process.env.FAST2SMS_WA_OTP_BUTTON || "").toLowerCase();
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

export function isWhatsAppConfigured(): boolean {
    if (!phoneNumberId() || !templateName()) return false;
    // Direct needs a Meta token; passthrough rides the Fast2SMS key.
    return Boolean(process.env.META_WA_ACCESS_TOKEN || process.env.FAST2SMS_API_KEY);
}

/**
 * Send a pre-generated OTP over WhatsApp to a 10-digit Indian mobile number.
 * `mobile` must be exactly 10 digits — no +91, no spaces; we add the country
 * code because Meta always wants the number in full international form.
 */
export async function sendOtpWhatsApp(mobile: string, code: string): Promise<void> {
    const numberId = phoneNumberId();
    const template = templateName();
    const direct = isDirectMode();
    const metaToken = process.env.META_WA_ACCESS_TOKEN;
    const fast2smsKey = process.env.FAST2SMS_API_KEY;

    if (!numberId) throw new WhatsAppNotConfiguredError();
    if (!template) throw new WhatsAppNotConfiguredError("WA_OTP_TEMPLATE missing");
    if (!direct && !fast2smsKey) {
        throw new WhatsAppNotConfiguredError("no META_WA_ACCESS_TOKEN and no FAST2SMS_API_KEY");
    }
    if (!/^[0-9]{10}$/.test(mobile)) {
        throw new Error(`WhatsApp needs a bare 10-digit number, got "${mobile}"`);
    }

    // Copy-code and one-tap templates repeat the code in the button payload,
    // each with its own parameter shape; a plain authentication template has
    // a body parameter only.
    const components: unknown[] = [{ type: "body", parameters: [{ type: "text", text: code }] }];
    const buttonKind = templateButtonKind();
    if (buttonKind === "copy_code") {
        components.push({
            type: "button",
            sub_type: "copy_code",
            index: "0",
            parameters: [{ type: "coupon_code", coupon_code: code }],
        });
    } else if (buttonKind === "one_tap") {
        components.push({
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: code }],
        });
    }

    // Identical body either way — only the endpoint and auth scheme differ.
    const url = direct
        ? `https://graph.facebook.com/${GRAPH_VERSION}/${numberId}/messages`
        : `https://www.fast2sms.com/dev/whatsapp/${GRAPH_VERSION}/${numberId}/messages`;
    const authHeader = direct ? `Bearer ${metaToken}` : fast2smsKey!;

    const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: `+91${mobile}`,
            type: "template",
            template: {
                name: template,
                language: { code: templateLang() },
                components,
            },
        }),
    });

    // Meta answers 200 with a message id on success and an `error` object on
    // failure, and Fast2SMS can wrap logical failures in its own `return:false`
    // shape — so status alone is not enough, same as the SMS sender.
    const bodyText = await res.text().catch(() => "");
    let parsed: {
        messages?: { id?: string }[];
        error?: { message?: string };
        return?: boolean;
        message?: unknown;
    } | null = null;
    try {
        parsed = JSON.parse(bodyText);
    } catch {
        /* non-JSON body — fall through to the status check */
    }

    const delivered = Boolean(parsed?.messages?.[0]?.id);
    if (!res.ok || parsed?.return === false || !delivered) {
        const detail =
            parsed?.error?.message ||
            (typeof parsed?.message === "string"
                ? parsed.message
                : Array.isArray(parsed?.message)
                  ? parsed.message.join("; ")
                  : bodyText.slice(0, 300));
        // Vendor reason goes to logs only — never to the customer.
        throw new Error(
            `WhatsApp send failed via ${direct ? "Meta direct" : "Fast2SMS"} (${res.status}): ${detail}`
        );
    }
}
