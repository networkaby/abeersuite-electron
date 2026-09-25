import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import {
    bumpAttempts,
    checkOtpCode,
    OTP_COOKIE,
    otpCookieOptions,
    packTicket,
    TICKET_COOKIE,
} from "@/shared/lib/auth/otpChallenge";
import { OTP_MAX_ATTEMPTS } from "@/shared/lib/constants/session";

/**
 * Check a typed code (SMS or email) against the pending cookie.
 *
 * On success the pending cookie is cleared and replaced with a short-lived
 * ticket cookie — that ticket is what the NextAuth provider trusts, so the
 * client can never assert "I am this mobile/email" by itself.
 *
 * The ticket is also returned in the body so the client seam can pass it to
 * `signIn()` unchanged; the cookie is the copy the server verifies.
 */

const bodySchema = z.object({
    code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export async function POST(req: NextRequest) {
    try {
        const { data, error } = await validateRequest(req, bodySchema);
        if (error) return error;

        const result = checkOtpCode(req.cookies.get(OTP_COOKIE)?.value, data.code);

        if (result.ok) {
            const ticket = packTicket(result.channel, result.identity);
            const res = NextResponse.json({ ticket, channel: result.channel });
            res.cookies.set(TICKET_COOKIE, ticket, otpCookieOptions);
            res.cookies.delete(OTP_COOKIE);
            return res;
        }

        // Wrong code → spend one attempt and keep the cookie alive.
        if (result.reason === "mismatch" && result.pending) {
            const left = OTP_MAX_ATTEMPTS - (result.pending.attempts + 1);
            const res = NextResponse.json(
                {
                    error:
                        left > 0
                            ? `That code did not match. ${left} ${left === 1 ? "try" : "tries"} left.`
                            : "Too many wrong codes. Please request a new one.",
                },
                { status: 400 }
            );
            res.cookies.set(OTP_COOKIE, bumpAttempts(result.pending), otpCookieOptions);
            return res;
        }

        const message =
            result.reason === "expired"
                ? "That code has expired. Please request a new one."
                : result.reason === "exhausted"
                  ? "Too many wrong codes. Please request a new one."
                  : "Please request a new code.";
        const res = NextResponse.json({ error: message }, { status: 400 });
        res.cookies.delete(OTP_COOKIE);
        return res;
    } catch (e) {
        return handleApiError(e, "Could not verify the code. Please try again.");
    }
}
