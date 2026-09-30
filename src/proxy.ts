import { auth } from "@/auth";
import { NextResponse, type NextFetchEvent, type NextMiddleware, type NextRequest } from "next/server";
import { isLegalPath } from "@/shared/lib/legal/legalPaths";
import { isStorefrontSlugPath } from "@/shared/lib/shop/storefrontSlugPath";
import { RELAY_ACTIVE } from "@/shared/lib/counter/relayPolicy";
import { canOpenPage, NO_ACCESS_HOME, NO_ACCESS_PARAM } from "@/shared/lib/auth/pageAccess";

function isPublicPath(pathname: string): boolean {
    if (pathname === "/" || pathname === "/login") return true;
    if (pathname === "/staff/login") return true;
    if (pathname === "/staff/forgot-password") return true;
    // Policy pages — Razorpay activation and Google OAuth verification fetch
    // these anonymously, so they must never redirect to a sign-in.
    if (isLegalPath(pathname)) return true;
    // Printer/display bridge — downloadable on the shop PC before sign-in.
    if (pathname === "/combined-bridge.zip") return true;
    if (pathname === "/combined-bridge-setup.exe") return true;
    if (pathname === "/combined-bridge-setup-offline.exe") return true;
    if (pathname === "/combined-bridge.version.json") return true;
    if (pathname.startsWith("/portal")) return true;
    if (pathname.startsWith("/shop")) return true;
    if (pathname === "/public/login") return true;
    // Root-level storefront slugs (/hp, /dell) — brand pages are part of the
    // shop and must stay browsable signed-out and as a signed-in customer.
    if (isStorefrontSlugPath(pathname)) return true;
    return false;
}

function wantsStaffSignIn(pathname: string): boolean {
    return (
        pathname.startsWith("/office") ||
        pathname.startsWith("/vouchers") ||
        pathname.startsWith("/receipt") ||
        pathname.startsWith("/shipping-") ||
        pathname.startsWith("/preview/")
    );
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

    if (!isAuthenticated) {
        if (!isPublicPath(pathname)) {
            const dest = wantsStaffSignIn(pathname)
                ? new URL("/staff/login", req.url)
                : new URL("/login", req.url);
            dest.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
            return NextResponse.redirect(dest);
        }
        return NextResponse.next();
    }

    if (pathname === "/login") {
        return NextResponse.redirect(new URL("/office/work-flow-inbox", req.url));
    }

    if (pathname === "/staff/login") {
        return NextResponse.redirect(new URL("/office/work-flow-inbox", req.url));
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
 * `/api` never goes through the session wrapper above: every route runs its own
 * `requireAuth()`, and resolving a session here would charge each call a
 * `tokensValidFrom` read for nothing. The only reason `/api` is in the matcher at all
 * is the `WRITE_MODE=v_live` write relay (see shared/lib/counter/writeRelay.ts); on
 * every other build this branch is a straight pass-through.
 */
export default function proxy(req: NextRequest, event: NextFetchEvent) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
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
