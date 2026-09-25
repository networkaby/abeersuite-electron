/**
 * Staff "Forgot password" — a 6-digit code to the staff address, then a new password.
 *
 * Public by design. Two POST bodies on one route:
 *   { email }                    → mail a code (always answers the same, so it never
 *                                  says whether an address has an account)
 *   { email, code, password }    → check the code, set the password
 *
 * Reuses the portal's signed-cookie OTP (otpChallenge.ts) under its own cookie name,
 * so a portal code in flight and a staff reset never step on each other. The mail goes
 * to `name@networkservice.in`; Cloudflare forwards it to the person's own inbox, which
 * they (or an admin) set on the profile (`/api/users/[id]/forward-email`).
 *
 * A successful reset bumps `tokensValidFrom`: whoever knew the old password is signed
 * out everywhere.
 */

import { NextResponse } from "next/server";
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
import { isEmailConfigured, sendEmail } from "@/shared/lib/email/sendEmail";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

const COOKIE = "staff_reset_otp";

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
        return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
    }
    recordLoginFailure(key);
    if (!isEmailConfigured()) {
        return NextResponse.json({ error: "Email is not set up on this server. Ask the office to reset it." }, { status: 503 });
    }

    const code = generateOtpCode();
    const user = await prismaAuthoritative.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
        await sendEmail({
            to: email,
            subject: `${code} is your ${COMPANY_DETAILS.brandName} password reset code`,
            text: [
                `Your password reset code is ${code}`,
                "",
                "It expires in 10 minutes. Type it on the reset page you already have open.",
                "If you did not ask for this, ignore this email — your password stays as it is.",
                "",
                COMPANY_DETAILS.brandName,
            ].join("\n"),
        });
    }
    // Same answer and same cookie whether or not the account exists.
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, packPendingOtp("email", email, code), otpCookieOptions);
    return res;
}

async function reset(email: string, code: string, password: string | undefined) {
    if (!password) return NextResponse.json({ error: "Enter a new password" }, { status: 400 });

    const raw = (await cookies()).get(COOKIE)?.value;
    const check = checkOtpCode(raw, code);
    if (!check.ok) {
        const res = NextResponse.json({
            error: check.reason === "mismatch" ? "That code is not right."
                : check.reason === "expired" ? "That code has expired. Send a new one."
                : check.reason === "exhausted" ? "Too many wrong tries. Send a new code."
                : "Send a code first.",
        }, { status: 400 });
        if (check.reason === "mismatch" && check.pending) res.cookies.set(COOKIE, bumpAttempts(check.pending), otpCookieOptions);
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
