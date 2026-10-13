import { auth, SESSION_COOKIE_NAME } from "@/auth";
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextFetchEvent, type NextMiddleware, type NextRequest } from "next/server";
import { isLegalPath } from "@/shared/lib/legal/legalPaths";
import { isStorefrontSlugPath } from "@/shared/lib/shop/storefrontSlugPath";
import { RELAY_ACTIVE } from "@/shared/lib/counter/relayPolicy";
import { canOpenPage, NO_ACCESS_HOME, NO_ACCESS_PARAM } from "@/shared/lib/auth/pageAccess";
import { isPhoneAppPath, isPhoneRequest, PHONE_APP_HOME, PHONE_APP_FORGOT, PHONE_APP_INSTALL, PHONE_APP_LOGIN } from "@/shared/lib/device/phone";
import { isPhoneOnlyApi, isPhoneOnlyPage, isPhoneOnlySession, phoneOnlyMayCall } from "@/shared/lib/auth/phoneOnly";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { appScreenFor, isShopNativePath, isShopNativeRequest, SHOP_APP_INSTALL, SHOP_NATIVE_DEV_COOKIE } from "@/shared/lib/device/shopApp";

function isPublicPath(pathname: string): boolean {
    if (pathname === "/" || pathname === "/login") return true;
    if (pathname === "/staff/login") return true;
    if (pathname === "/staff/forgot-password") return true;
    // The staff phone app's install page — the Downloads QR opens it on a phone that
    // is not signed in yet; installing needs no sign-in.
    if (pathname === PHONE_APP_INSTALL) return true;
    if (pathname === PHONE_APP_LOGIN || pathname === PHONE_APP_FORGOT) return true;
    // Policy pages — Razorpay activation and Google OAuth verification fetch
    // these anonymously, so they must never redirect to a sign-in.
    if (isLegalPath(pathname)) return true;
    // Printer/display bridge — downloadable on the shop PC before sign-in.
    if (pathname === "/combined-bridge.zip") return true;
    if (pathname === "/combined-bridge-setup.exe") return true;
    if (pathname === "/combined-bridge-setup-offline.exe") return true;
    if (pathname === "/combined-bridge.version.json") return true;
    // The customer app's install page — the WhatsApp bill message links here.
    if (pathname === SHOP_APP_INSTALL) return true;
    if (pathname.startsWith("/portal")) return true;
    if (pathname.startsWith("/shop")) return true;
    // The customer app's screens — browsing the shop needs no sign-in; the
    // account screens check the customer session themselves, like /portal.
    if (isShopNativePath(pathname)) return true;
    if (pathname === "/public/login") return true;
    // Root-level storefront slugs (/hp, /dell) — brand pages are part of the
    // shop and must stay browsable signed-out and as a signed-in customer.
    if (isStorefrontSlugPath(pathname)) return true;
    return false;
}

function wantsStaffSignIn(pathname: string): boolean {
    return (
        pathname.startsWith("/office") ||
        isPhoneAppPath(pathname) ||
        pathname.startsWith("/vouchers") ||
        pathname.startsWith("/receipt") ||
        pathname.startsWith("/shipping-") ||
        pathname.startsWith("/preview/")
    );
}

/**
 * Where a signed-in staff member lands from a sign-in page: back to the phone app
 * when that is where they came from (`callbackUrl` under /m) or they are on a
 * phone, else the office home.
 */
function staffHome(req: NextRequest, phoneOnly: boolean): URL {
    const back = req.nextUrl.searchParams.get("callbackUrl") ?? "";
    if (isPhoneAppPath(back.split("?")[0])) return new URL(back, req.url);
    return new URL(phoneOnly || isPhoneRequest(req.headers) ? PHONE_APP_HOME : "/office/work-flow-inbox", req.url);
}

/**
 * Page requests: resolve the session and redirect anyone who should not be here.
 *
 * next-auth types this wrapper as a route handler, but it has always been invoked
 * here as middleware with `(req, event)` — that is what `export default auth(…)` did
 * before `/api` needed its own branch — so the type is asserted, not the behaviour.
 */
const pageProxy = auth((req) => {
    const { pathname } = req.nextUrl;

    // The customer app's screens open only inside the app (owner, 2026-10-08):
    // a browser on any device is offered the app instead.
    if (
        isShopNativePath(pathname) &&
        !isShopNativeRequest(req.headers.get("user-agent") ?? "", req.cookies.get(SHOP_NATIVE_DEV_COOKIE)?.value)
    ) {
        return NextResponse.redirect(new URL(SHOP_APP_INSTALL, req.url));
    }
    // Inside the app, website addresses that lead into it land on the app's own
    // screen: a payment gateway's return to the order page (PayU, Cashfree) and
    // the short link every customer message carries.
    if (isShopNativeRequest(req.headers.get("user-agent") ?? "", req.cookies.get(SHOP_NATIVE_DEV_COOKIE)?.value)) {
        const inApp = appScreenFor(pathname);
        if (inApp) {
            const dest = new URL(inApp, req.url);
            dest.search = req.nextUrl.search;
            return NextResponse.redirect(dest);
        }
    }

    if (pathname === "/portal/login") {
        const dest = new URL("/login", req.url);
        dest.search = req.nextUrl.search;
        return NextResponse.redirect(dest);
    }

    const session = req.auth;
    const isAuthenticated = !!session?.user;
    const user = session?.user as { kind?: string } | undefined;
    const isCustomer = user?.kind === "customer";

    if (isAuthenticated && isCustomer && pathname === "/login") {
        return NextResponse.redirect(new URL("/portal", req.url));
    }

    if (isAuthenticated && isCustomer && pathname === "/staff/login") {
        return NextResponse.redirect(new URL("/portal", req.url));
    }

    if (isAuthenticated && isCustomer && !isPublicPath(pathname)) {
        return NextResponse.redirect(new URL("/portal", req.url));
    }

    // A phone stays in the staff phone app: every other staff page — an office
    // screen, a voucher form, a print — sends it to /m, signed in or not (signed
    // out, /m then asks for the sign-in and comes back). Shop, portal and the
    // sign-in pages are not staff pages and are never touched, so a customer on a
    // phone shops as before. Chrome's "Desktop site" switch turns this off.
    if (wantsStaffSignIn(pathname) && !isPhoneAppPath(pathname) && isPhoneRequest(req.headers)) {
        return NextResponse.redirect(new URL(PHONE_APP_HOME, req.url));
    }

    if (!isAuthenticated) {
        if (!isPublicPath(pathname)) {
            // The phone app signs in on its own page, inside its PWA scope.
            const dest = isPhoneAppPath(pathname)
                ? new URL(PHONE_APP_LOGIN, req.url)
                : wantsStaffSignIn(pathname)
                ? new URL("/staff/login", req.url)
                : new URL("/login", req.url);
            dest.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
            return NextResponse.redirect(dest);
        }
        return NextResponse.next();
    }

    const phoneOnly = isPhoneOnlySession(session?.user);
    if (pathname === "/login" || pathname === "/staff/login" || pathname === PHONE_APP_LOGIN) {
        return NextResponse.redirect(staffHome(req, phoneOnly));
    }

    // A phone-only sign-in (auth/phoneOnly.ts) stays in the phone app, on any device.
    // Public pages — shop, portal, policies — are open to anyone and stay open.
    if (phoneOnly && !isPublicPath(pathname) && !isPhoneOnlyPage(pathname)) {
        return NextResponse.redirect(new URL(PHONE_APP_HOME, req.url));
    }

    // Page lock: an office page opens only on its own sidebar tick (pageAccess.ts), so
    // a typed address cannot reach what the Role page hides. The ticks ride the session
    // already resolved above — no extra read.
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!canOpenPage(pathname, permissions)) {
        const dest = new URL(NO_ACCESS_HOME, req.url);
        dest.searchParams.set(NO_ACCESS_PARAM, "1");
        return NextResponse.redirect(dest);
    }

    return NextResponse.next();
}) as unknown as NextMiddleware;

/**
 * The ticks of a phone-only sign-in making this API call, or null when it is not
 * one. Checked here once for every route — several routes read `auth()` directly
 * instead of `requireAuth()`, so a check in the routes would have holes. Reads the
 * token itself (a decrypt, no database read), and only when a session cookie is
 * there at all. A counter never mints a phone-only session (authorizeStaff.ts), so
 * it skips this.
 */
async function phoneOnlyCaller(req: NextRequest): Promise<{ permissions: string[] } | null> {
    if (IS_COUNTER_PC) return null;
    if (!req.cookies.getAll().some((c) => c.name.startsWith(SESSION_COOKIE_NAME))) return null;
    const token = await getToken({
        req,
        secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
        cookieName: SESSION_COOKIE_NAME,
        salt: SESSION_COOKIE_NAME,
    }).catch(() => null);
    if (!isPhoneOnlySession(token)) return null;
    const permissions = (token as { permissions?: unknown }).permissions;
    return { permissions: Array.isArray(permissions) ? permissions.filter((p): p is string => typeof p === "string") : [] };
}

/**
 * `/api` never goes through the session wrapper above: every route runs its own
 * `requireAuth()`, and resolving a session here would charge each call a
 * `tokensValidFrom` read for nothing. `/api` is in the matcher for two things: the
 * phone-only fence (`phoneOnlyCaller`, a token decrypt only), and the
 * `WRITE_MODE=v_live` write relay (see shared/lib/counter/writeRelay.ts).
 */
export default async function proxy(req: NextRequest, event: NextFetchEvent) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
        // A v_live till's save, signed in by its counter key rather than a cookie
        // (auth/counterRelayAuth.ts). Never on a counter: a till does not accept
        // another till's key. Loaded only when the header is there.
        if (!IS_COUNTER_PC && req.headers.get("authorization")?.startsWith("Counter ")) {
            const { authenticateCounterRequest } = await import("@/shared/lib/auth/counterRelayAuth");
            const result = await authenticateCounterRequest(req.headers);
            if (result && !result.ok) {
                return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
            }
            if (result?.ok) {
                const headers = new Headers(req.headers);
                headers.set("cookie", result.cookie);
                headers.delete("authorization");
                return NextResponse.next({ request: { headers } });
            }
        }
        if (!isPhoneOnlyApi(req.nextUrl.pathname)) {
            const phoneOnly = await phoneOnlyCaller(req);
            if (phoneOnly && !phoneOnlyMayCall(req.nextUrl.pathname, phoneOnly.permissions)) {
                return NextResponse.json({ error: "The phone app sign-in opens the phone app only." }, { status: 403 });
            }
        }
        if (!RELAY_ACTIVE) return NextResponse.next();
        // Loaded only on a relaying counter, and only once: keeps `pg` and the relay
        // out of every other build's proxy, and its first load (the first API call
        // after boot) opens the worker's "rows applied" line ahead of the first save.
        return import("@/shared/lib/counter/writeRelay")
            .then(({ relayWrite }) => relayWrite(req))
            .then((relayed) => relayed ?? NextResponse.next());
    }
    return pageProxy(req, event);
}

export const config = {
    matcher: [
        // Skip Next internals and any static file in /public (anything with a file
        // extension). Without the extension escape, /logo.svg and friends get
        // auth-redirected to /login and serve HTML instead of the asset.
        // The staff print surfaces (`receipt`, `shipping-slip`, `shipping-label`) are
        // deliberately NOT excluded any more — each page under them calls
        // requireStaffPage() itself, but proxy coverage is defense in depth against a
        // page that forgets. They render for a signed-in staff session as before.
        // `/api` IS matched, for the write relay — see `proxy()` above.
        "/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)",
    ],
};
