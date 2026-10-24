import "server-only";
import { encode } from "next-auth/jwt";
import { fillTokenFromUser, SESSION_COOKIE_NAME } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { staffAuthUserById } from "@/shared/lib/auth/authorizeStaff";
import { hashCounterKey } from "@/shared/lib/counter/counterKeyHash";
import { LOGIN_IDLE_MAX_AGE_MS, SESSION_REVOKED_MESSAGE } from "@/shared/lib/constants/session";

/**
 * The office half of the till's counter key (`counter/relayKey.ts` is the till half).
 *
 * A `WRITE_MODE=v_live` till relays a save with
 *   Authorization: Counter <counterId>.<key>
 *   x-abeer-acting-user: <the user id of the till's own, still-valid session>
 * and no cookie — the till's cookie is signed with the till's own secret and means
 * nothing here. `src/proxy.ts` calls this before any route runs: the key is checked
 * against `PosCounter.relayKeyHash` (or the previous hash, mid-renewal), the person's
 * authority is rebuilt from the database, and a short-lived session cookie for them is
 * put on the request. Every route then reads `auth()` exactly as for a website user —
 * nothing downstream knows a till sent it.
 *
 * What the office trusts: that the till names the person truthfully. A copied key
 * could speak for anyone; revoking the counter's key ends that, and it is still far
 * narrower than the office `AUTH_SECRET` every till used to carry.
 */

export const COUNTER_AUTH_SCHEME = "Counter ";
export const ACTING_USER_HEADER = "x-abeer-acting-user";
/** The office refused the counter key itself — revoked, unknown, or a released counter. */
export const COUNTER_KEY_REFUSED = "COUNTER_KEY_REFUSED";

/** Checks are cached so a busy till pays one lookup per few minutes, not one per bill.
 *  A revoke therefore takes up to this long to bite. */
const KEY_CACHE_MS = 5 * 60_000;
/** Short: a role change should count at the office on the next save or two. */
const USER_CACHE_MS = 30_000;
/** Auth.js splits a cookie above this into `<name>.0`, `<name>.1`, … and reads it back. */
const COOKIE_CHUNK = 3933;

const keyCache = new Map<string, { ok: boolean; at: number }>();
const userCache = new Map<number, { user: Awaited<ReturnType<typeof staffAuthUserById>>; at: number }>();

async function keyIsValid(counterId: number, key: string): Promise<boolean> {
    const hash = hashCounterKey(key);
    const cacheKey = `${counterId}:${hash}`;
    const hit = keyCache.get(cacheKey);
    if (hit && Date.now() - hit.at < KEY_CACHE_MS) return hit.ok;
    const row = await prisma.posCounter.findUnique({
        where: { id: counterId },
        select: { isActive: true, boundDeviceId: true, relayKeyHash: true, relayKeyPrevHash: true, relayKeyRevokedAt: true },
    });
    const ok = !!row && row.isActive && !!row.boundDeviceId && !row.relayKeyRevokedAt
        && (row.relayKeyHash === hash || row.relayKeyPrevHash === hash);
    keyCache.set(cacheKey, { ok, at: Date.now() });
    return ok;
}

async function actingUser(id: number) {
    const hit = userCache.get(id);
    if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.user;
    const user = await staffAuthUserById(prisma, id);
    userCache.set(id, { user, at: Date.now() });
    return user;
}

function sessionCookie(jwt: string): string {
    if (jwt.length <= COOKIE_CHUNK) return `${SESSION_COOKIE_NAME}=${jwt}`;
    const parts: string[] = [];
    for (let i = 0; i * COOKIE_CHUNK < jwt.length; i++) {
        parts.push(`${SESSION_COOKIE_NAME}.${i}=${jwt.slice(i * COOKIE_CHUNK, (i + 1) * COOKIE_CHUNK)}`);
    }
    return parts.join("; ");
}

export type CounterAuthResult =
    | { ok: true; cookie: string; counterId: number }
    | { ok: false; status: 401; error: string; code: string };

/** Null when the request carries no counter key — an ordinary website request. */
export async function authenticateCounterRequest(headers: Headers): Promise<CounterAuthResult | null> {
    const authorization = headers.get("authorization");
    if (!authorization?.startsWith(COUNTER_AUTH_SCHEME)) return null;

    const refused = (code: string, error: string): CounterAuthResult => ({ ok: false, status: 401, error, code });
    const raw = authorization.slice(COUNTER_AUTH_SCHEME.length).trim();
    const dot = raw.indexOf(".");
    const counterId = Number(raw.slice(0, dot));
    const key = raw.slice(dot + 1);
    if (dot < 1 || !Number.isInteger(counterId) || counterId <= 0 || key.length < 32) {
        return refused(COUNTER_KEY_REFUSED, "This counter's office key is not valid.");
    }
    if (!(await keyIsValid(counterId, key))) {
        return refused(COUNTER_KEY_REFUSED, "This counter's office key was refused — it was revoked or the counter was released.");
    }

    const userId = Number(headers.get(ACTING_USER_HEADER));
    if (!Number.isInteger(userId) || userId <= 0) {
        return refused("Unauthorized", "Unauthorized");
    }
    const user = await actingUser(userId);
    // Left, or gone: the till's session speaks for nobody any more — sign them out there.
    if (!user) return refused("SESSION_REVOKED", SESSION_REVOKED_MESSAGE);

    const token: Record<string, unknown> = { name: user.name, email: user.email, sub: String(user.id) };
    fillTokenFromUser(token, user);
    token.counterId = counterId;
    const jwt = await encode({
        token,
        secret: (process.env.AUTH_SECRET)!,
        salt: SESSION_COOKIE_NAME,
        maxAge: LOGIN_IDLE_MAX_AGE_MS / 1000,
    });
    return { ok: true, cookie: sessionCookie(jwt), counterId };
}
