import { signOut } from "next-auth/react";

/**
 * Did the person themselves end this session?
 *
 * A session can end three ways and they must not read alike on screen: they signed
 * out, an admin changed their access, or it simply went cold (6 idle hours — see
 * src/auth.ts). Only the last two deserve a word of explanation; announcing "your
 * session expired" to somebody who just clicked Sign out is nonsense.
 *
 * A module-level flag is enough and a stored one would be worse: it is set
 * synchronously before `signOut()` flips the session, so SessionWrapper's guard —
 * which runs in this same page before the navigation — always sees it, and it dies
 * with the page so it can never go stale and swallow a real expiry later.
 */
let deliberate = false;

/** Call immediately before any `signOut()` that the person asked for. */
export function markDeliberateSignOut(): void { deliberate = true; }

/** True when the session that just ended was ended on purpose. */
export function wasDeliberateSignOut(): boolean { return deliberate; }

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
