import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { authorizeStaffCredentials } from "@/shared/lib/auth/authorizeStaff";
import { authorizePortalCredentials } from "@/shared/lib/auth/authorizePortal";
import { IS_PUBLIC } from "@/shared/lib/appMode";
import { PIN_PASSWORD_MAX_AGE_MS } from "@/shared/lib/auth/counterPin";

/**
 * One session-cookie NAME on every deployment, office and counters alike.
 *
 * Auth.js would otherwise call it `__Secure-authjs.session-token` on https and
 * `authjs.session-token` on http — and it derives the token's encryption key from the
 * secret AND that name (`salt = cookieName` in @auth/core/jwt). A `WRITE_MODE=v_live`
 * till relays its writes to the office with its own cookie, so the office must be able
 * to decrypt a token minted on http://127.0.0.1: same secret (shipped in counter.env),
 * same name (this). Only the `secure` flag still follows the protocol.
 *
 * Pinning the name changed it on the web deployment, so every office user signed in
 * once more after that deploy; old `__Secure-` cookies linger harmlessly until expiry.
 */
const SESSION_COOKIE_NAME = "authjs.session-token";
const SECURE_COOKIES =
    !!process.env.VERCEL || /^https:/i.test(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "");

export const { handlers, signIn, signOut, auth } = NextAuth({
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    trustHost: true,
    /**
     * A session lasts exactly as long as a PIN may stand in for a password, and
     * every request pushes that back.
     *
     * The two clocks used to disagree, and the longer one won by default. The PIN
     * rules (counterPin.ts) send a cashier back to their password after 10 days —
     * but they are only read AT the sign-in screen, and Auth.js's own default kept
     * a session 30 days and re-issued it on use. So anyone who never signed out
     * never reached the screen, and the 10-day rule never ran for them at all. On
     * live, user 38 last authenticated on 19 Sep and was still validly signed in on
     * the 21st, which is how a worked day ended up with no arrival time recorded.
     *
     * Tying maxAge to PIN_PASSWORD_MAX_AGE_MS makes it one number instead of two:
     * shorten the PIN rule and the session follows, and neither can drift past the
     * other. `updateAge: 0` re-issues on every request, so the clock measures time
     * SINCE LAST USE — a till worked every day is never interrupted mid-shift, and
     * a machine left idle falls due on the same 10 days as the PIN it is standing
     * in for. No DB read: the token is re-signed, nothing is looked up.
     */
    session: {
        strategy:  "jwt",
        maxAge:    PIN_PASSWORD_MAX_AGE_MS / 1000,   // seconds
        updateAge: 0,                                 // refresh on every use
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
                token.loginAt = Date.now();   // for server-side revocation
                token.id = user.id;
                token.role = "role" in user && typeof user.role === "string" ? user.role : "";
                token.roles = "roles" in user && Array.isArray(user.roles) ? (user.roles as string[]) : [];
                token.permissions =
                    "permissions" in user && Array.isArray(user.permissions)
                        ? (user.permissions as string[])
                        : [];
                token.rank = "rank" in user && typeof user.rank === "number" ? user.rank : 0;
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
                return token;
            }
            // ── Server-side revocation (staff only) ──────────────────────────
            // On every subsequent request, reject a token whose login predates the
            // user's `tokensValidFrom` (bumped on sign-out). This is what makes
            // "logout" actually invalidate a stateless JWT server-side — so a
            // logged-out till can't keep transacting.
            if (token.id && token.kind !== "customer") {
                try {
                    const u = await prisma.user.findUnique({
                        where: { id: Number(token.id) },
                        select: { tokensValidFrom: true },
                    });
                    const validFrom = u?.tokensValidFrom?.getTime();
                    const loginAt = typeof token.loginAt === "number" ? token.loginAt : 0;
                    // Need a loginAt to compare — tokens minted before this feature
                    // have none, so they're left alone (a fresh login stamps it).
                    if (validFrom && loginAt && loginAt < validFrom) {
                        token.revoked = true;
                    }
                } catch {
                    // DB hiccup → fail OPEN so a transient outage can't mass-logout
                    // every cashier. prisma's read-retry makes this rare.
                }
            }
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
                    customerId?: string;
                    activeAccountId?: string;
                    activeAccountType?: "personal" | "company";
                };
                sessionUser.id = token.id as string;
                sessionUser.role = typeof token.role === "string" ? token.role : "";
                sessionUser.roles = Array.isArray(token.roles) ? (token.roles as string[]) : [sessionUser.role];
                sessionUser.permissions = Array.isArray(token.permissions) ? (token.permissions as string[]) : [];
                sessionUser.rank = typeof token.rank === "number" ? token.rank : 0;
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
        // Sign-out bumps tokensValidFrom → every existing token for this user is
        // rejected on its next request (logout = log out of every tab/device).
        //
        // Authoritative on purpose: on a counter the ordinary client writes to the
        // replica and queues the row for push, and `User` is a model a counter must
        // never push — so the row dead-lettered and the shell showed "Sync error (1)"
        // after every sign-out. Revocation is best-effort anyway; offline it is skipped.
        async signOut(message) {
            const token = "token" in message ? message.token : null;
            const id = token?.id;
            if (id && token?.kind !== "customer") {
                await prismaAuthoritative.user
                    .update({ where: { id: Number(id) }, data: { tokensValidFrom: new Date() } })
                    .catch(() => { /* best-effort — don't block sign-out on a DB hiccup */ });
            }
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
                async authorize(credentials) {
                    if (!credentials?.email || !credentials?.password) return null;
                    return authorizeStaffCredentials(
                        prisma,
                        credentials.email as string,
                        credentials.password as string
                    );
                },
            }),
        ]),
        // Counter PIN — the same staff session, reached by six digits instead of a
        // password. Left off the public build with the staff provider above, and
        // refused outright by `authorizeStaffPin` anywhere that is not a counter,
        // so on the office deployment this provider exists but can never succeed.
        ...(IS_PUBLIC ? [] : [
            Credentials({
                id: "credentials-staff-pin",
                name: "Counter PIN",
                credentials: {
                    email: { label: "Email", type: "email" },
                    pin: { label: "PIN", type: "password" },
                },
                async authorize(credentials) {
                    if (!credentials?.email || !credentials?.pin) return null;
                    const { authorizeStaffPin } = await import("@/shared/lib/auth/authorizeStaff");
                    return authorizeStaffPin(
                        prisma,
                        credentials.email as string,
                        credentials.pin as string
                    );
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
            // Passwordless portal sign-in: SMS OTP, emailed OTP, or Google.
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
