/**
 * Staff "Forgot password" — a 6-digit code to the staff address, then a new password.
 *
 * Public by design. Two POST bodies on one route:
 *   { email }                    → mail a code (always answers the same, so it never
 *                                  says whether an address has an account — the mail
 *                                  goes out after the response, so not by timing either)
 *   { email, code, password }    → check the code, set the password
 *
 * Only an address that could sign in with the new password gets a code: a staff-domain
 * User not marked as left — the same two checks `authorizeStaffCredentials` makes.
 *
 * Wrong codes are counted on the server as well, per address (inside `checkOtpCode`).
 * The count inside the cookie only binds an honest browser: a script can replay the
 * first cookie (0 tries) forever and guess its way through the million codes.
 *
 * Reuses the portal's signed-cookie OTP (otpChallenge.ts) under its own cookie name,
 * so a portal code in flight and a staff reset never step on each other. The mail goes
 * to `name@networkservice.in`; Cloudflare forwards it to the person's own inbox, which
 * they (or an admin) set on the profile (`/api/users/[id]/forward-email`).
 *
 * A successful reset bumps `tokensValidFrom`: whoever knew the old password is signed
 * out everywhere.
 */

import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import {
    bumpAttempts,
    checkOtpCode,
    generateOtpCode,
    otpCookieOptions,
    packPendingOtp,
} from "@/shared/lib/auth/otpChallenge";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "@/shared/lib/auth/loginRateLimit";
import { isStaffEmailDomainAllowed } from "@/shared/lib/auth/staffEmailAllowlist";
import { isEmailConfigured } from "@/shared/lib/email/sendEmail";
import { sendCodeEmail } from "@/shared/lib/email/codeEmail";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";

const COOKIE = "staff_reset_otp";
const TOO_MANY = "Too many attempts. Please wait a few minutes.";

const schema = z.object({
    email: z.string().trim().toLowerCase().email("Enter your staff email"),
    code: z.string().trim().optional(),
    password: z.string().min(6, "Password must be at least 6 characters").optional(),
});

export async function POST(req: Request) {
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        return data.code ? await reset(data.email, data.code, data.password) : await send(data.email);
    } catch (e) {
        return handleApiError(e, "Could not reset the password. Please try again.");
    }
}

async function send(email: string) {
    const key = `staff-reset-send:${email}`;
    if (isLoginBlocked(key)) {
        return NextResponse.json({ error: TOO_MANY }, { status: 429 });
    }
    recordLoginFailure(key);
    if (!isEmailConfigured()) {
        return NextResponse.json({ error: "Email is not set up on this server. Ask the office to reset it." }, { status: 503 });
    }

    const code = generateOtpCode();
    const user = isStaffEmailDomainAllowed(email)
        ? await prismaAuthoritative.user.findUnique({ where: { email }, select: { staffProfile: { select: { leftOn: true } } } })
        : null;
    if (user && !staffHasLeft(user.staffProfile)) {
        // After the response: a real address must answer as fast as a made-up one, and
        // a failed send must not turn into an error only a real address can produce.
        after(() => sendCodeEmail("STAFF_PASSWORD_RESET", email, code).catch((e: unknown) => console.error("[staff password reset] code mail failed", e)));
    }
    // Same answer and same cookie whether or not the account exists.
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, packPendingOtp("email", email, code), otpCookieOptions);
    return res;
}

async function reset(email: string, code: string, password: string | undefined) {
    if (!password) return NextResponse.json({ error: "Enter a new password" }, { status: 400 });

    const raw = (await cookies()).get(COOKIE)?.value;
    // Counts wrong codes per address the code was SENT to (the signed cookie), never
    // the typed one, which the caller can change on every try.
    const check = await checkOtpCode(raw, code, "staff-reset-code");
    if (!check.ok && check.reason === "blocked") {
        return NextResponse.json({ error: TOO_MANY }, { status: 429 });
    }
    if (!check.ok) {
        const res = NextResponse.json({
            error: check.reason === "mismatch" ? "That code is not right."
                : check.reason === "expired" ? "That code has expired. Send a new one."
                : check.reason === "exhausted" ? "Too many wrong tries. Send a new code."
                : "Send a code first.",
        }, { status: 400 });
        if (check.reason === "mismatch") res.cookies.set(COOKIE, bumpAttempts(check.pending), otpCookieOptions);
        return res;
    }
    // The code was for the address typed with it, not whatever is in the box now.
    if (check.identity !== email) return NextResponse.json({ error: "That code was sent to another address." }, { status: 400 });

    const hashed = await bcrypt.hash(password, 10);
    const done = await prismaAuthoritative.user.updateMany({
        where: { email },
        data: { password: hashed, tokensValidFrom: new Date() },
    });
    if (done.count === 0) return NextResponse.json({ error: "That code is not right." }, { status: 400 });

    clearLoginFailures(email);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(COOKIE);
    return res;
}
