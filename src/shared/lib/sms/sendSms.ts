import "server-only";

/**
 * SMS delivery via Fast2SMS — the project's first SMS sender.
 *
 * Fast2SMS is used for *delivery only*. It can generate and verify OTPs itself
 * (`/dev/otp/send` without an `otp`, then `/dev/otp/verify`), and we
 * deliberately do not use that:
 *   - we would still need our own ticket to bind "verified" to this browser,
 *     so their verify step buys nothing and costs a round trip;
 *   - their verify response shape is undocumented, and an auth decision must
 *     not hang on parsing an unspecified body;
 *   - passing our own code keeps SMS and email on one identical verification
 *     path (see `otpChallenge.ts`), with one expiry and one attempt budget.
 *
 * So we generate the code, hand it over, and treat Fast2SMS as a pipe.
 * Swapping vendor (MSG91, Twilio, Gupshup, WhatsApp) means rewriting the one
 * `deliver*` function below.
 *
 * ── Route choice (FAST2SMS_ROUTE) ────────────────────────────────────────────
 * India's TRAI rules require DLT registration for commercial SMS, which not
 * every business can obtain. Fast2SMS sells two routes that avoid it by sending
 * under *their* registration with a random numeric sender ID:
 *
 *   "q"   Quick SMS  — free-text message, no template, no DLT.
 *                      Costs ~Rs 5 per SMS: fine for low volume, expensive at
 *                      scale. This is the default because it needs nothing but
 *                      an API key.
 *   "otp" OTP API    — uses a template registered in the Fast2SMS dashboard
 *                      (FAST2SMS_OTP_TEMPLATE_ID). Much cheaper per message.
 *
 * Start on "q" to go live today, move to "otp" once a template is set up.
 */

import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

const BULK_URL = "https://www.fast2sms.com/dev/bulkV2";
const SEND_OTP_URL = "https://www.fast2sms.com/dev/otp/send";

/** Kept short — one SMS segment is 160 characters. */
const COMPANY_NAME = COMPANY_DETAILS.brandName;

/** Which Fast2SMS route to send through. */
function route(): "q" | "otp" {
    return process.env.FAST2SMS_ROUTE === "otp" ? "otp" : "q";
}

export class SmsNotConfiguredError extends Error {
    constructor(detail = "FAST2SMS_API_KEY missing") {
        super(`SMS sending is not set up yet (${detail}).`);
        this.name = "SmsNotConfiguredError";
    }
}

export function isSmsConfigured(): boolean {
    if (!process.env.FAST2SMS_API_KEY) return false;
    // The template route additionally needs a template id.
    return route() === "q" || Boolean(process.env.FAST2SMS_OTP_TEMPLATE_ID);
}

/**
 * Send a pre-generated OTP to a 10-digit Indian mobile number.
 * `mobile` must be exactly 10 digits — no +91, no spaces.
 */
export async function sendOtpSms(mobile: string, code: string): Promise<void> {
    if (!process.env.FAST2SMS_API_KEY) throw new SmsNotConfiguredError();
    if (!/^[0-9]{10}$/.test(mobile)) {
        throw new Error(`Fast2SMS needs a bare 10-digit number, got "${mobile}"`);
    }

    const usingTemplate = route() === "otp";
    if (usingTemplate && !process.env.FAST2SMS_OTP_TEMPLATE_ID) {
        throw new SmsNotConfiguredError("FAST2SMS_ROUTE=otp but FAST2SMS_OTP_TEMPLATE_ID missing");
    }

    const { url, body } = usingTemplate
        ? {
              url: SEND_OTP_URL,
              body: {
                  mobile,
                  otp_id: process.env.FAST2SMS_OTP_TEMPLATE_ID,
                  // Our own code — Fast2SMS just substitutes it into the template.
                  otp: code,
                  // Their expiry sits a little beyond ours so the SMS never dies
                  // before our cookie does; our cookie is the real clock.
                  otp_expiry: 15,
              },
          }
        : {
              url: BULK_URL,
              body: {
                  route: "q",
                  numbers: mobile,
                  // Free text on the Quick route — no template, so we write it.
                  // Kept short: one SMS segment is 160 chars.
                  message: `${code} is your ${COMPANY_NAME} sign-in code. Valid 10 minutes. Do not share it with anyone.`,
              },
          };

    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: process.env.FAST2SMS_API_KEY,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    // Fast2SMS returns 200 with `return: false` for some logical failures, so
    // status alone is not enough.
    const bodyText = await res.text().catch(() => "");
    let parsed: { return?: boolean; message?: unknown } | null = null;
    try {
        parsed = JSON.parse(bodyText);
    } catch {
        /* non-JSON body — fall through to the status check */
    }

    if (!res.ok || parsed?.return === false) {
        const detail =
            typeof parsed?.message === "string"
                ? parsed.message
                : Array.isArray(parsed?.message)
                  ? parsed.message.join("; ")
                  : bodyText.slice(0, 300);
        // Vendor reason goes to logs only — never to the customer.
        throw new Error(`Fast2SMS send failed via route "${route()}" (${res.status}): ${detail}`);
    }
}
