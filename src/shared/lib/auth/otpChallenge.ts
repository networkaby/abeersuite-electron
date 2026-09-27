import "server-only";

/**
 * OTP challenge — stateless, cookie-backed, shared by SMS and email.
 *
 * Deliberately no DB table. The pending code lives in a signed httpOnly cookie
 * holding `channel . identity . expiry . attempts . hash(code)`, HMAC'd with
 * AUTH_SECRET. That means:
 *   - no schema change / prod db push to ship this,
 *   - nothing to clean up when a code is never used,
 *   - the raw code is never stored anywhere, only its hash.
 *
 * The customer types the code in the same browser that requested it, so a cookie
 * is the natural place for the pending state. (This is precisely why we do NOT
 * use email sign-in links: a link must survive being opened in a *different*
 * browser, which forces an extra confirm-your-email step.)
 *
 * Both channels share this one path on purpose — SMS via Fast2SMS and email via
 * Resend are pure *delivery*; neither vendor is trusted to decide who is
 * authenticated. A successful verify swaps the pending cookie for a short-lived
 * "ticket" cookie, which the NextAuth provider consumes.
 *
 * The channel is bound into both cookies, so a ticket earned by verifying a
 * mobile number can never be replayed as an email identity, or vice versa.
 *
 * The one piece of server state: wrong codes are also counted in memory, per
 * identity (`loginRateLimit`). The tries count inside the cookie only binds an
 * honest browser — a script can replay the first cookie (0 tries) forever and
 * guess its way through the million codes. `checkOtpCode` does the counting
 * itself, so no caller can forget it.
 */

import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { OTP_CODE_TTL_MS, OTP_MAX_ATTEMPTS, OTP_TICKET_TTL_MS } from "@/shared/lib/constants/session";
import { clearLoginFailures, loginTriesLeft, recordLoginFailure } from "@/shared/lib/auth/loginRateLimit";

export const OTP_COOKIE = "portal_otp";
export const TICKET_COOKIE = "portal_otp_ticket";

export type OtpChannel = "mobile" | "email";

/** Verified identity: normalized digits for mobile, the address for email. */
export type OtpIdentity = { channel: OtpChannel; identity: string };

function secret(): string {
    const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    if (!s) throw new Error("AUTH_SECRET is not set — OTP cannot be signed.");
    return s;
}

function sign(payload: string): string {
    return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Constant-time compare that cannot throw on length mismatch. */
function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

/** Six digits, uniformly random, leading zeros allowed. */
export function generateOtpCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// ── Pending-code cookie ──────────────────────────────────────────────────────

/** `channel|identity|expiry|attempts|codeHash|sig` */
export function packPendingOtp(channel: OtpChannel, identity: string, code: string): string {
    const expiry = Date.now() + OTP_CODE_TTL_MS;
    const codeHash = sign(`${channel}:${identity}:${code}`);
    const body = [channel, identity, String(expiry), "0", codeHash].join("|");
    return `${body}|${sign(body)}`;
}

type PendingOtp = {
    channel: OtpChannel;
    identity: string;
    expiry: number;
    attempts: number;
    codeHash: string;
};

function parsePendingOtp(raw: string): PendingOtp | null {
    const parts = raw.split("|");
    if (parts.length !== 6) return null;
    const [channel, identity, expiryStr, attemptsStr, codeHash, sig] = parts;
    if (channel !== "mobile" && channel !== "email") return null;
    if (!safeEqual(sig, sign([channel, identity, expiryStr, attemptsStr, codeHash].join("|")))) {
        return null;
    }
    const expiry = Number(expiryStr);
    const attempts = Number(attemptsStr);
    if (!Number.isFinite(expiry) || !Number.isFinite(attempts)) return null;
    return { channel, identity, expiry, attempts, codeHash };
}

/** Re-pack with the attempt counter bumped, so a wrong guess costs a try. */
export function bumpAttempts(pending: PendingOtp): string {
    const body = [
        pending.channel,
        pending.identity,
        String(pending.expiry),
        String(pending.attempts + 1),
        pending.codeHash,
    ].join("|");
    return `${body}|${sign(body)}`;
}

export type OtpCheck =
    | { ok: true; channel: OtpChannel; identity: string }
    /** `triesLeft`: the smaller of the cookie's budget and the server's. */
    | { ok: false; reason: "mismatch"; pending: PendingOtp; triesLeft: number }
    | { ok: false; reason: "missing" | "tampered" | "blocked" | "expired" | "exhausted" };

/**
 * Check a typed code against the pending cookie, counting wrong codes on the
 * server under `scope` (one name per route, e.g. "portal-otp-code"), so two
 * routes never share a budget.
 *
 * The key is the identity the code was SENT to, out of the signed cookie —
 * never anything typed. Once "blocked", even a right code is refused, so the
 * answer never tells a guesser they got there.
 */
export function checkOtpCode(rawCookie: string | undefined, code: string, scope: string): OtpCheck {
    if (!rawCookie) return { ok: false, reason: "missing" };
    const pending = parsePendingOtp(rawCookie);
    if (!pending) return { ok: false, reason: "tampered" };
    const guessKey = `${scope}:${pending.channel}:${pending.identity}`;
    if (loginTriesLeft(guessKey, OTP_MAX_ATTEMPTS) <= 0) return { ok: false, reason: "blocked" };
    if (Date.now() > pending.expiry) return { ok: false, reason: "expired" };
    if (pending.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "exhausted" };
    if (!safeEqual(pending.codeHash, sign(`${pending.channel}:${pending.identity}:${code}`))) {
        recordLoginFailure(guessKey);
        const triesLeft = Math.min(
            OTP_MAX_ATTEMPTS - (pending.attempts + 1),
            loginTriesLeft(guessKey, OTP_MAX_ATTEMPTS)
        );
        return { ok: false, reason: "mismatch", pending, triesLeft };
    }
    clearLoginFailures(guessKey);
    return { ok: true, channel: pending.channel, identity: pending.identity };
}

// ── Verified-identity ticket ─────────────────────────────────────────────────

/** `channel|identity|expiry|sig` — proof this browser verified this identity. */
export function packTicket(channel: OtpChannel, identity: string): string {
    const expiry = Date.now() + OTP_TICKET_TTL_MS;
    const body = [channel, identity, String(expiry)].join("|");
    return `${body}|${sign(body)}`;
}

/** Returns the verified identity, or null if the ticket is bad/expired. */
export function readTicket(raw: string | undefined): OtpIdentity | null {
    if (!raw) return null;
    const parts = raw.split("|");
    if (parts.length !== 4) return null;
    const [channel, identity, expiryStr, sig] = parts;
    if (channel !== "mobile" && channel !== "email") return null;
    if (!safeEqual(sig, sign([channel, identity, expiryStr].join("|")))) return null;
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || Date.now() > expiry) return null;
    return { channel, identity };
}

/** Shared cookie options — httpOnly so client JS can never read a code hash. */
export const otpCookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
};
