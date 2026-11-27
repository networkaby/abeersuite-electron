import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The "password note" behind a counter PIN (owner, 2026-11-27).
 *
 * The PIN is kept only on the counter PC (`electron/pinVault.ts`) and the server
 * never sees it. What the PC holds next to it is this: a note the server signed when
 * the person typed their password on that counter — "user U, counter C, at T". The
 * PIN unlocks the note on the PC; the note signs the person in
 * (`authorizeStaffResume`), and only while it is still good:
 *
 *   • on counter C, and only inside a counter shell (`thisCounterId()`);
 *   • within 10 days of T (`LOGIN_MAX_AGE_MS`) — T becomes the token's `passwordAt`;
 *   • not before the person's `tokensValidFrom` — "Sign out everywhere", a password
 *     change or a role edit end every note too;
 *   • the person is not marked as left.
 *
 * Stateless: signed with AUTH_SECRET, nothing stored on the server.
 */

export interface ResumeGrant { uid: number; cid: number; at: number }

const LABEL = "counter-resume:v1";

function sign(body: string): string {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not set");
    return createHmac("sha256", `${LABEL}:${secret}`).update(body).digest("base64url");
}

export function issueResumeGrant(grant: ResumeGrant): string {
    const body = Buffer.from(JSON.stringify(grant)).toString("base64url");
    return `${body}.${sign(body)}`;
}

/** The note's contents if the signature holds — the caller checks the rules above. */
export function readResumeGrant(token: string): ResumeGrant | null {
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const want = Buffer.from(sign(body));
    const got = Buffer.from(mac);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
        const g = JSON.parse(Buffer.from(body, "base64url").toString()) as Partial<ResumeGrant>;
        return typeof g.uid === "number" && typeof g.cid === "number" && typeof g.at === "number"
            ? { uid: g.uid, cid: g.cid, at: g.at }
            : null;
    } catch {
        return null;
    }
}
