import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import {
    isLikelyEmail,
    normalizeMobile10,
    normalizePortalEmail,
} from "@/shared/lib/auth/portalIdentifier";
import {
    generateOtpCode,
    OTP_COOKIE,
    otpCookieOptions,
    packPendingOtp,
    TICKET_COOKIE,
} from "@/shared/lib/auth/otpChallenge";
import { isLoginBlocked, recordLoginFailure } from "@/shared/lib/auth/loginRateLimit";
import { isEmailConfigured, sendEmail } from "@/shared/lib/email/sendEmail";
import { isSmsConfigured, sendOtpSms, SMS_PARTNER_LABEL } from "@/shared/lib/sms/sendSms";
import { isWhatsAppConfigured, sendOtpWhatsApp } from "@/shared/lib/whatsapp/sendWhatsApp";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * Send a 6-digit sign-in code to a mobile or email — the customer types one
 * field and we pick the channel.
 *
 * Public by design (signing in is what it's for), so it is throttled per
 * identifier: without that it is a free WhatsApp/email cannon pointed at any
 * number or address, and every message costs real money.
 */

const bodySchema = z.object({
    identifier: z.string().trim().min(3, "Enter your mobile number or email"),
    /** "sms": the customer tapped "Send by SMS instead" — skip WhatsApp. */
    via: z.enum(["sms"]).optional(),
    /** How many SMS this screen has already asked for — picks the next provider. */
    smsTry: z.number().int().min(0).max(100).optional(),
});

/**
 * Deliver a mobile code over the cheapest pipe that is set up.
 *
 * WhatsApp first, SMS second. If WhatsApp refuses — the customer has no
 * WhatsApp, the number is unreachable, the template is paused — we retry over
 * SMS through every provider that has a key (see `sendSms.ts`); with none a
 * WhatsApp failure ends in `MobileOtpUndeliveredError`. Both pipes carry the
 * *same* code, so a customer who somehow gets both can use either.
 */
class MobileOtpUndeliveredError extends Error {}

/**
 * `remote`: the SMS provider made its own code (MiniMoth) and must verify it.
 * `smsOnly`: the customer asked for SMS — Meta accepts a WhatsApp message for a
 * phone with no internet and just holds it, so no automatic fallback happens.
 */
async function sendMobileOtp(
    mobile: string,
    code: string,
    smsOnly: boolean,
    smsTry: number
): Promise<{ via: "whatsapp" | "sms"; remote: boolean; partner?: string }> {
    if (!smsOnly && isWhatsAppConfigured()) {
        try {
            await sendOtpWhatsApp(mobile, code);
            return { via: "whatsapp", remote: false };
        } catch (e) {
            console.error("WhatsApp OTP failed:", e);
            if (!isSmsConfigured()) throw new MobileOtpUndeliveredError();
        }
    }
    try {
        const { provider, held } = await sendOtpSms(mobile, code, smsTry);
        return { via: "sms", remote: held === "remote", partner: SMS_PARTNER_LABEL[provider] };
    } catch (e) {
        // Every provider failed (each logged in sendSms) — same polite answer.
        console.error("SMS OTP failed on every provider:", e);
        throw new MobileOtpUndeliveredError();
    }
}

export async function POST(req: Request) {
    try {
        const { data, error } = await validateRequest(req, bodySchema);
        if (error) return error;

        const raw = data.identifier;
        const asEmail = isLikelyEmail(raw);
        // Mobile is pinned to exactly 10 digits here — see `normalizeMobile10`.
        const identity = asEmail ? normalizePortalEmail(raw) : normalizeMobile10(raw);

        if (!identity) {
            return NextResponse.json(
                { error: "Enter a valid 10-digit mobile number, or an email address" },
                { status: 400 }
            );
        }
        if (asEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identity)) {
            return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
        }

        // Throttle before doing any work. The key is namespaced so burning the
        // send budget does NOT also lock this identifier out of password login
        // (both would otherwise share one counter).
        const throttleKey = `otp-send:${identity}`;
        if (isLoginBlocked(throttleKey)) {
            return NextResponse.json(
                { error: "Too many attempts. Please wait a few minutes and try again." },
                { status: 429 }
            );
        }
        recordLoginFailure(throttleKey);

        const channel = asEmail ? "email" : "mobile";
        // Mobile has two pipes: WhatsApp leads, SMS (once a provider is set up)
        // is the fallback for customers WhatsApp cannot reach.
        const smsOnly = !asEmail && data.via === "sms";
        const configured = asEmail
            ? isEmailConfigured()
            : smsOnly
              ? isSmsConfigured()
              : isWhatsAppConfigured() || isSmsConfigured();
        if (!configured) {
            return NextResponse.json(
                {
                    error: asEmail
                        ? "Email sign-in is not set up yet. Please use mobile OTP or password."
                        : "Mobile sign-in is not set up yet. Please use email OTP, Google or password.",
                },
                { status: 503 }
            );
        }

        const code = generateOtpCode();
        // Which pipe actually carried it, so the screen can say "check WhatsApp"
        // or "check your texts" — the customer cannot guess.
        let via: "email" | "whatsapp" | "sms" = "email";
        let remote = false;
        // Which delivery partner carried an SMS — named on the code screen.
        let partner: string | undefined;

        if (asEmail) {
            await sendEmail({
                to: identity,
                subject: `${code} is your ${COMPANY_DETAILS.brandName} sign-in code`,
                text: [
                    `Your sign-in code is ${code}`,
                    "",
                    "It expires in 10 minutes. Type it on the sign-in page you already have open.",
                    "If you did not request this, you can ignore this email — nobody can sign in without the code.",
                    "",
                    COMPANY_DETAILS.brandName,
                ].join("\n"),
            });
        } else {
            // Already exactly 10 bare digits, which is what both pipes want.
            ({ via, remote, partner } = await sendMobileOtp(identity, code, smsOnly, data.smsTry ?? 0));
        }

        // smsAvailable: whether the code screen may offer "Send by SMS instead".
        const res = NextResponse.json({
            ok: true,
            channel,
            via,
            smsAvailable: !asEmail && isSmsConfigured(),
            partner,
        });
        res.cookies.set(OTP_COOKIE, packPendingOtp(channel, identity, code, remote), otpCookieOptions);
        // Drop any earlier verified ticket so a new send always re-verifies.
        res.cookies.delete(TICKET_COOKIE);
        return res;
    } catch (e) {
        if (e instanceof MobileOtpUndeliveredError) {
            return NextResponse.json(
                { error: "We could not send the code to this mobile. Please use email OTP, Google or password." },
                { status: 502 }
            );
        }
        return handleApiError(e, "Could not send the code. Please try again.");
    }
}
