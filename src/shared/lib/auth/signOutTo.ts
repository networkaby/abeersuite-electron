import { signOut } from "next-auth/react";

/**
 * Did the person themselves end this session?
 *
 * A session can end three ways and they must not read alike on screen: they signed
 * out, an admin changed their access, or it simply went cold (3 idle days — see
 * src/auth.ts). Only the last two deserve a word of explanation; announcing "your
 * session expired" to somebody who just clicked Sign out is nonsense.
 *
 * A module-level flag is enough and a stored one would be worse: it is set
 * synchronously before `signOut()` flips the session, so SessionWrapper's guard —
 * which runs in this same page before the navigation — always sees it, and it dies
 * with the page so it can never go stale and swallow a real expiry later.
 */
let deliberate = false;

/**
 * Other windows of the app share the cookie, so a sign-out here ends them too — and
 * next-auth tells them only THAT it happened, never why. Without a word of our own
 * each one would announce "signed out after 3 days with nothing happening" to the
 * person who had just clicked Sign out. The word goes out before `signOut()` makes its
 * request, so it lands ahead of next-auth's own broadcast, which waits for the reply.
 */
const SIGN_OUT_CHANNEL = "abeer-sign-out";

/** A word from another window explains only the session end that follows it. */
const HEARD_FRESH_MS = 10_000;
let heard: { at: number; notice: string | null } | null = null;
const heardFresh = () => heard !== null && Date.now() - heard.at < HEARD_FRESH_MS;

/**
 * Call immediately before any `signOut()` that the person asked for — or one whose
 * reason is already on screen here (idle, revoked, counter released). Pass that
 * reason as `notice`: the other windows show it too, rather than jumping to the
 * login page in silence. A plain Sign out click passes none; the person knows.
 */
export function markDeliberateSignOut(notice: string | null = null): void {
    deliberate = true;
    try {
        const channel = new BroadcastChannel(SIGN_OUT_CHANNEL);
        channel.postMessage({ notice });
        channel.close();
    } catch { /* no BroadcastChannel: the other windows fall back to the idle notice */ }
}

/** True when the session that just ended was ended on purpose, here or in another window. */
export function wasDeliberateSignOut(): boolean { return deliberate || heardFresh(); }

/** The reason another window just gave for ending the session, if it gave one. */
export function heardSignOutNotice(): string | null { return heardFresh() ? heard!.notice : null; }

if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    new BroadcastChannel(SIGN_OUT_CHANNEL).onmessage = (e: MessageEvent) => {
        const notice = (e.data as { notice?: unknown } | null)?.notice;
        heard = { at: Date.now(), notice: typeof notice === "string" ? notice : null };
    };
}

/**
 * Sign out and land on `path` of the SAME host the user is already on.
 *
 * Why not `signOut({ callbackUrl: path })`: NextAuth resolves a relative
 * callbackUrl against `baseUrl` — that is NEXTAUTH_URL, not the browser's
 * address bar. With office and shop on separate subdomains, a staff member
 * signing out of office.networkservice.in was thrown across to
 * shop.networkservice.in/staff/login. Passing an absolute URL does not help
 * either: NextAuth's default redirect callback rejects any origin that is not
 * `baseUrl` and falls back to `baseUrl` anyway.
 *
 * So we take the redirect away from NextAuth. `redirect: false` reduces it to
 * clearing the session, then a plain browser navigation goes where we say —
 * and a browser resolves a leading-slash path against the current origin, which
 * is exactly the "stay on your own subdomain" rule we want.
 *
 * `assign` rather than `replace`: signing out is a real navigation, and Back
 * should return you to a signed-out page, not silently re-enter the app.
 */
export async function signOutTo(path: string): Promise<void> {
    markDeliberateSignOut();
    await signOut({ redirect: false });
    window.location.assign(path);
}
