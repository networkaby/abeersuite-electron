import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import {
    isLikelyEmail,
    normalizePortalEmail,
    normalizePortalPhone,
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
import { isSmsConfigured, sendOtpSms } from "@/shared/lib/sms/sendSms";
import { isWhatsAppConfigured, sendOtpWhatsApp } from "@/shared/lib/whatsapp/sendWhatsApp";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * Send a 6-digit sign-in code to a mobile or email — the customer types one
 * field and we pick the channel.
 *
 * Public by design (signing in is what it's for), so it is throttled per
 * identifier: without that it is a free SMS/email cannon pointed at any
 * number or address, and SMS costs real money per message.
 */

const bodySchema = z.object({
    identifier: z.string().trim().min(3, "Enter your mobile number or email"),
});

/**
 * Deliver a mobile code over the cheapest pipe that is set up.
 *
 * WhatsApp first, SMS second. If WhatsApp refuses — the customer has no
 * WhatsApp, the number is unreachable, the template is paused — we still owe
 * them a code, so we retry over SMS rather than fail the sign-in. Both pipes
 * carry the *same* code, so a customer who somehow gets both can use either.
 */
async function sendMobileOtp(mobile: string, code: string): Promise<void> {
    if (isWhatsAppConfigured()) {
        try {
            await sendOtpWhatsApp(mobile, code);
            return;
        } catch (e) {
            if (!isSmsConfigured()) throw e;
            console.error("WhatsApp OTP failed, falling back to SMS:", e);
        }
    }
    await sendOtpSms(mobile, code);
}

export async function POST(req: Request) {
    try {
        const { data, error } = await validateRequest(req, bodySchema);
        if (error) return error;

        const raw = data.identifier;
        const asEmail = isLikelyEmail(raw);
        const identity = asEmail ? normalizePortalEmail(raw) : normalizePortalPhone(raw);

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
        // Mobile has two pipes. WhatsApp is far cheaper per code than the SMS
        // `q` route, so it leads whenever its WABA is set up; SMS stays as the
        // fallback for customers WhatsApp cannot reach.
        const configured = asEmail
            ? isEmailConfigured()
            : isWhatsAppConfigured() || isSmsConfigured();
        if (!configured) {
            return NextResponse.json(
                {
                    error: asEmail
                        ? "Email sign-in is not set up yet. Please use mobile OTP or password."
                        : "SMS sign-in is not set up yet. Please use email OTP or password.",
                },
                { status: 503 }
            );
        }

        const code = generateOtpCode();

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
            // normalizePortalPhone yields bare digits; Fast2SMS wants exactly 10.
            await sendMobileOtp(identity.slice(-10), code);
        }

        const res = NextResponse.json({ ok: true, channel });
        res.cookies.set(OTP_COOKIE, packPendingOtp(channel, identity, code), otpCookieOptions);
        // Drop any earlier verified ticket so a new send always re-verifies.
        res.cookies.delete(TICKET_COOKIE);
        return res;
    } catch (e) {
        return handleApiError(e, "Could not send the code. Please try again.");
    }
}
