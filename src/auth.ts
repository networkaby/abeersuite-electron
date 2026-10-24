import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { authorizeStaffCredentials, authorizeStaffPin } from "@/shared/lib/auth/authorizeStaff";
import { authorizePortalCredentials } from "@/shared/lib/auth/authorizePortal";
import { IS_PUBLIC } from "@/shared/lib/appMode";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import {
    DEFAULT_IDLE_LIMIT_MINUTES,
    LOGIN_IDLE_MAX_AGE_MS,
    LOGIN_MAX_AGE_MS,
    PHONE_LOGIN_IDLE_MAX_AGE_MS,
    PHONE_LOGIN_MAX_AGE_MS,
    SESSION_COOKIE_MAX_AGE_MS,
    SESSION_RENEW_EVERY_S,
} from "@/shared/lib/constants/session";
import { PHONE_APP_UA } from "@/shared/lib/device/phone";
import { localSignOutAt, markLocalSignOut } from "@/shared/lib/auth/localSignOut";

/**
 * One session-cookie NAME on every deployment, office and counters alike.
 *
 * Auth.js would otherwise call it `__Secure-authjs.session-token` on https and
 * `authjs.session-token` on http — and it derives the token's encryption key from the
 * secret AND that name (`salt = cookieName` in @auth/core/jwt). A `WRITE_MODE=v_live`
 * till used to relay its writes to the office with its own cookie, so the office had to
 * decrypt a token minted on http://127.0.0.1 — hence one name. Since 2026-10-13 each
 * machine has its own secret and a till signs in at the office with its counter key
 * (`counter/relayKey.ts`), so the cookie never leaves the till; the single name stays so
 * nobody is signed out again. Only the `secure` flag differs: on for Vercel (https), off
 * elsewhere.
 *
 * Pinning the name changed it on the web deployment, so every office user signed in
 * once more after that deploy; old `__Secure-` cookies linger harmlessly until expiry.
 */
export const SESSION_COOKIE_NAME = "authjs.session-token";
// Vercel is the only https host; the dev server and counters serve plain http.
const SECURE_COOKIES = !!process.env.VERCEL;

export const { handlers, signIn, signOut, auth } = NextAuth({
    secret: process.env.AUTH_SECRET,
    trustHost: true,
    /**
     * A login lasts until one of two clocks runs out (owner, 2026-10-13): 3 days with
     * nobody using it or 10 days since the password was typed — both checked on every
     * request in `isStaffTokenRevoked`. The staff phone app gets 30 / 90 days and a
     * customer 90 days with nobody using it (owner, 2026-10-18); the cookie lives as
     * long as the longest of them, and `token.seenAt` carries the shorter idle clocks. Inside those two
     * clocks a counter's 4-digit PIN signs a person back in (`counterPin.ts`).
     *
     * It replaced a 6-hour lifetime that signed every till out each night, which is
     * what made coming back slow. The idle limit per person ("Sign out after", HR → Job)
     * is the short clock now; this is only the backstop.
     *
     * Renewed at most every 5 minutes (`SESSION_RENEW_EVERY_S`) — it was every
     * request, and a request still in flight at Sign out put a fresh cookie back.
     */
    session: {
        strategy:  "jwt",
        maxAge:    SESSION_COOKIE_MAX_AGE_MS / 1000, // seconds
        updateAge: SESSION_RENEW_EVERY_S,             // renew at most this often
    },
    cookies: {
        sessionToken: {
            name: SESSION_COOKIE_NAME,
            options: { httpOnly: true, sameSite: "lax", path: "/", secure: SECURE_COOKIES },
        },
    },
    pages: {
        signIn: "/login",
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                fillTokenFromUser(token, user);
                return token;
            }
            // ── Server-side revocation (staff only) ──────────────────────────
            // On every subsequent request, reject a token whose login predates the
            // user's `tokensValidFrom` (an admin's "end every login") or, on a till,
            // this till's own sign-out mark — see `isStaffTokenRevoked`.
            if (await isStaffTokenRevoked(token)) token.revoked = true;
            else token.seenAt = Date.now();   // the idle clock — saved whenever the cookie is renewed
            return token;
        },
        async session({ session, token }) {
            // Revoked server-side → present a session with no user so requireAuth()
            // (which checks `!session.user`) rejects it with 401.
            //
            // The `revoked` flag rides along so that 401 can say WHY. Without it the
            // rejection is indistinguishable from "never signed in", and the browser
            // simply jumped to the login screen mid-work with nothing on it — which is
            // what a permission change looks like to a cashier: a random logout. The
            // token is still refused either way; only the silence goes.
            if (token?.revoked) {
                const s = session as unknown as { user?: unknown; revoked?: boolean };
                s.user = undefined;
                s.revoked = true;
                return session;
            }
            if (token) {
                const sessionUser = session.user as typeof session.user & {
                    id: string;
                    role: string;
                    roles: string[];
                    permissions: string[];
                    idleLimitMinutes: number;
                    rank: number;
                    scope: string;
                    roleLabel?: string;
                    roleColor?: string;
                    departmentIds: string[];
                    branchIds: string[];
                    title?: string;
                    seats: { title: string; scope: string }[];
                    avatarUrl?: string;
                    kind?: "staff" | "customer";
                    phoneOnly?: true;
                    customerId?: string;
                    activeAccountId?: string;
                    activeAccountType?: "personal" | "company";
                };
                sessionUser.id = token.id as string;
                sessionUser.role = typeof token.role === "string" ? token.role : "";
                sessionUser.roles = Array.isArray(token.roles) ? (token.roles as string[]) : [sessionUser.role];
                sessionUser.permissions = Array.isArray(token.permissions) ? (token.permissions as string[]) : [];
                sessionUser.rank = typeof token.rank === "number" ? token.rank : 0;
                sessionUser.idleLimitMinutes =
                    typeof token.idleLimitMinutes === "number" ? token.idleLimitMinutes : DEFAULT_IDLE_LIMIT_MINUTES;
                sessionUser.scope = typeof token.scope === "string" ? token.scope : "OWN";
                sessionUser.roleLabel = typeof token.roleLabel === "string" ? token.roleLabel : undefined;
                sessionUser.roleColor = typeof token.roleColor === "string" ? token.roleColor : undefined;
                sessionUser.departmentIds = Array.isArray(token.departmentIds)
                    ? (token.departmentIds as string[])
                    : [];
                sessionUser.branchIds = Array.isArray(token.branchIds) ? (token.branchIds as string[]) : [];
                sessionUser.title = typeof token.title === "string" ? token.title : undefined;
                sessionUser.seats = Array.isArray(token.seats)
                    ? (token.seats as { title: string; scope: string }[])
                    : [];
                sessionUser.avatarUrl = typeof token.avatarUrl === "string" ? token.avatarUrl : undefined;
                sessionUser.kind = token.kind === "customer" ? "customer" : "staff";
                if (token.phoneOnly === true) sessionUser.phoneOnly = true;
                sessionUser.customerId =
                    typeof token.customerId === "string" ? token.customerId : undefined;
                sessionUser.activeAccountId =
                    typeof token.activeAccountId === "string" ? token.activeAccountId : undefined;
                sessionUser.activeAccountType =
                    token.activeAccountType === "company" || token.activeAccountType === "personal"
                        ? token.activeAccountType
                        : undefined;
            }
            return session;
        },
    },
    events: {
        // Sign-out ends THIS login only (owner, 2026-10-13). On a till it writes the
        // till's own mark, so a cookie renewed by a request already in flight is
        // refused here, and nothing else — the office site, other tills, the till's
        // counter key — is touched. On the office site clearing the cookie is the
        // whole of it. Ending every login of a person is an admin act
        // (`revokeSessions.ts` → `User.tokensValidFrom`), no longer a side effect of
        // pressing Sign out.
        async signOut(message) {
            const token = "token" in message ? message.token : null;
            if (!token?.id || token.kind === "customer") return;
            if (IS_COUNTER_PC) markLocalSignOut(String(token.id));
        },
    },
    providers: [
        // The staff provider is left off the public (shop) build entirely —
        // office pages are already stripped there, so shipping a staff auth
        // path alongside them would be a door with no room behind it.
        ...(IS_PUBLIC ? [] : [
            Credentials({
                id: "credentials-staff",
                name: "Staff",
                credentials: {
                    email: { label: "Email", type: "email" },
                    password: { label: "Password", type: "password" },
                },
                async authorize(credentials, request) {
                    if (!credentials?.email || !credentials?.password) return null;
                    const user = await authorizeStaffCredentials(
                        prisma,
                        credentials.email as string,
                        credentials.password as string
                    );
                    // Signed in from the staff phone app → the phone's longer clocks.
                    const phoneApp = (request?.headers?.get("user-agent") ?? "").includes(PHONE_APP_UA);
                    return user && phoneApp ? { ...user, phoneApp: true } : user;
                },
            }),
            // Counter PIN — the same staff session, reached by four digits on a tapped
            // photograph (owner, 2026-10-15). `authorizeStaffPin` refuses anywhere that
            // is not a counter, so on the office deployment it can never succeed.
            Credentials({
                id: "credentials-staff-pin",
                name: "Counter PIN",
                credentials: {
                    email: { label: "Email", type: "email" },
                    pin: { label: "PIN", type: "password" },
                },
                async authorize(credentials) {
                    if (!credentials?.email || !credentials?.pin) return null;
                    return authorizeStaffPin(prisma, credentials.email as string, credentials.pin as string);
                },
            }),
        ]),
        Credentials({
            id: "credentials-portal",
            name: "Portal",
            credentials: {
                identifier: { label: "Mobile or email", type: "text" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.identifier || !credentials?.password) return null;
                return authorizePortalCredentials(
                    prisma,
                    credentials.identifier as string,
                    credentials.password as string
                );
            },
        }),
        Credentials({
            // Passwordless portal sign-in: mobile (WhatsApp) OTP, emailed OTP, or Google.
            // `token` is the only thing that authenticates — a verified Firebase
            // ID token or our own email ticket. `name`/`extraContact` are used
            // only when creating a customer we have never seen before.
            id: "credentials-portal-passwordless",
            name: "Portal OTP",
            credentials: {
                token: { label: "Verification token", type: "text" },
                name: { label: "Name", type: "text" },
                extraContact: { label: "Other contact", type: "text" },
            },
            async authorize(credentials) {
                const token = typeof credentials?.token === "string" ? credentials.token : "";
                if (!token) return null;

                // Imported lazily: this module pulls in jose + the portal
                // lookup code, and `auth` is also imported by proxy.ts
                // (middleware, every request). Keep it out of that hot path.
                const { authorizePortalPasswordless } = await import(
                    "@/shared/lib/auth/authorizePortalPasswordless"
                );

                const result = await authorizePortalPasswordless(prisma, {
                    token,
                    name: typeof credentials?.name === "string" ? credentials.name : "",
                    extraContact:
                        typeof credentials?.extraContact === "string" ? credentials.extraContact : "",
                });
                // "needsOnboarding" is not an error the client can act on here —
                // the UI asks /passwordless-identity first and collects a name,
                // so reaching this branch means sign in without one: refuse.
                return result.status === "ok" ? result.user : null;
            },
        }),
    ],
});

/**
 * Everything a staff or customer sign-in puts on the token. One copy, because the
 * office mints the same token for a till's counter key (`counterRelayAuth.ts`) — a
 * second copy would drift and hand relayed saves a different authority.
 */
export function fillTokenFromUser(token: Record<string, unknown>, user: { id?: string | null }): void {
    token.loginAt = Date.now();   // for server-side revocation
    token.seenAt = token.loginAt; // the idle clock (`isStaffTokenRevoked`)
    // The 10-day clock. A PIN sign-in carries the counter's stamp of the last password,
    // so it never restarts the clock; everything else typed the password just now.
    token.passwordAt = "passwordAt" in user && typeof user.passwordAt === "number" ? user.passwordAt : token.loginAt;
    token.id = user.id;
    token.role = "role" in user && typeof user.role === "string" ? user.role : "";
    token.roles = "roles" in user && Array.isArray(user.roles) ? (user.roles as string[]) : [];
    token.permissions =
        "permissions" in user && Array.isArray(user.permissions)
            ? (user.permissions as string[])
            : [];
    token.rank = "rank" in user && typeof user.rank === "number" ? user.rank : 0;
    // Carried on the token so the client's idle timer knows this person's
    // own limit from the first render, with no request of its own.
    token.idleLimitMinutes =
        "idleLimitMinutes" in user && typeof user.idleLimitMinutes === "number"
            ? user.idleLimitMinutes
            : DEFAULT_IDLE_LIMIT_MINUTES;
    token.scope = "scope" in user && typeof user.scope === "string" ? user.scope : "OWN";
    token.roleLabel =
        "roleLabel" in user && typeof user.roleLabel === "string" ? user.roleLabel : undefined;
    token.roleColor =
        "roleColor" in user && typeof user.roleColor === "string" ? user.roleColor : undefined;
    token.departmentIds =
        "departmentIds" in user && Array.isArray(user.departmentIds)
            ? (user.departmentIds as string[])
            : [];
    token.branchIds =
        "branchIds" in user && Array.isArray(user.branchIds) ? (user.branchIds as string[]) : [];
    token.title = "title" in user ? (user.title as string | undefined) : undefined;
    // Every Position they hold, for the counter's sign-in card. Two short
    // strings per seat, and almost everyone holds one.
    token.seats = "seats" in user && Array.isArray(user.seats) ? user.seats : [];
    token.avatarUrl = "avatarUrl" in user ? (user.avatarUrl as string | undefined) : undefined;
    token.kind = "kind" in user && user.kind === "customer" ? "customer" : "staff";
    // Phone app only (auth/phoneOnly.ts) — proxy.ts reads it off the token.
    if ("phoneOnly" in user && user.phoneOnly === true) token.phoneOnly = true;
    // Signed in inside the staff phone app — its 30 / 90-day clocks apply.
    if ("phoneApp" in user && user.phoneApp === true) token.phoneApp = true;
    token.customerId =
        "customerId" in user && typeof user.customerId === "string" ? user.customerId : undefined;
    token.activeAccountId =
        "activeAccountId" in user && typeof user.activeAccountId === "string"
            ? user.activeAccountId
            : undefined;
    token.activeAccountType =
        "activeAccountType" in user && (user.activeAccountType === "personal" || user.activeAccountType === "company")
            ? user.activeAccountType
            : undefined;
}

/**
 * Is this staff token dead? Two stamps and one clock can end it:
 *
 *   • `User.tokensValidFrom` — "end every login": a role / position / permission edit,
 *     a password change (`revokeSessions.ts`). Everywhere, office and tills alike.
 *   • On a till, this till's own sign-out mark (`localSignOut.ts`). A Sign out on one
 *     till ends that till's login and nothing else (owner, 2026-10-13).
 *   • 10 days since the password was typed (`LOGIN_MAX_AGE_MS`), from `passwordAt` —
 *     a counter PIN sign-in carries the old stamp forward, so it never resets it.
 *     Tokens from before `passwordAt` fall back to `loginAt`.
 *   • 3 days with nobody using it (`LOGIN_IDLE_MAX_AGE_MS`), from `seenAt`. The
 *     cookie itself lives 90 days for customers, so this clock is on the token.
 *   • A phone-app login (`token.phoneApp`) gets 90 days and 30 days instead.
 *
 * Tokens minted before `loginAt` existed are left alone. A DB hiccup fails OPEN so a
 * transient outage cannot mass-logout every cashier; prisma's read-retry makes it rare.
 * Shared with the write relay, which must not speak for a login the till has ended.
 */
export async function isStaffTokenRevoked(token: Record<string, unknown>): Promise<boolean> {
    if (!token.id || token.kind === "customer") return false;
    const loginAt = typeof token.loginAt === "number" ? token.loginAt : 0;
    if (!loginAt) return false;
    const passwordAt = typeof token.passwordAt === "number" ? token.passwordAt : loginAt;
    const phone = token.phoneApp === true;
    if (Date.now() - passwordAt > (phone ? PHONE_LOGIN_MAX_AGE_MS : LOGIN_MAX_AGE_MS)) return true;
    // Tokens from before `seenAt` existed: the cookie held them to 3 days already.
    const seenAt = typeof token.seenAt === "number" ? token.seenAt : 0;
    if (seenAt && Date.now() - seenAt > (phone ? PHONE_LOGIN_IDLE_MAX_AGE_MS : LOGIN_IDLE_MAX_AGE_MS)) return true;
    if (IS_COUNTER_PC && loginAt < localSignOutAt(String(token.id))) return true;
    try {
        const u = await prisma.user.findUnique({
            where: { id: Number(token.id) },
            select: { tokensValidFrom: true },
        });
        const validFrom = u?.tokensValidFrom?.getTime();
        return !!validFrom && loginAt < validFrom;
    } catch {
        return false;
    }
}
