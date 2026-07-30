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
 */

import { createHmac, randomInt, timingSafeEqual } from "crypto";

export const OTP_COOKIE = "portal_otp";
export const TICKET_COOKIE = "portal_otp_ticket";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes to read the code and type it
const TICKET_TTL_MS = 5 * 60 * 1000; // 5 minutes to finish sign-in / onboarding
export const MAX_ATTEMPTS = 5; // wrong guesses before the code dies

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
    const expiry = Date.now() + CODE_TTL_MS;
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
    | {
          ok: false;
          reason: "missing" | "tampered" | "expired" | "exhausted" | "mismatch";
          pending?: PendingOtp;
      };

/** Check a typed code against the pending cookie. */
export function checkOtpCode(rawCookie: string | undefined, code: string): OtpCheck {
    if (!rawCookie) return { ok: false, reason: "missing" };
    const pending = parsePendingOtp(rawCookie);
    if (!pending) return { ok: false, reason: "tampered" };
    if (Date.now() > pending.expiry) return { ok: false, reason: "expired" };
    if (pending.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "exhausted" };
    if (!safeEqual(pending.codeHash, sign(`${pending.channel}:${pending.identity}:${code}`))) {
        return { ok: false, reason: "mismatch", pending };
    }
    return { ok: true, channel: pending.channel, identity: pending.identity };
}

// ── Verified-identity ticket ─────────────────────────────────────────────────

/** `channel|identity|expiry|sig` — proof this browser verified this identity. */
export function packTicket(channel: OtpChannel, identity: string): string {
    const expiry = Date.now() + TICKET_TTL_MS;
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
