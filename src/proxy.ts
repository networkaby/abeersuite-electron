import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { isLegalPath } from "@/shared/lib/legal/legalPaths";
import { isStorefrontSlugPath } from "@/shared/lib/shop/storefrontSlugPath";

function isPublicPath(pathname: string): boolean {
    if (pathname === "/" || pathname === "/login") return true;
    if (pathname === "/staff/login") return true;
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
        pathname.startsWith("/lab") ||
        pathname.startsWith("/receipt") ||
        pathname.startsWith("/shipping-")
    );
}

export default auth((req) => {
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

    return NextResponse.next();
});

export const config = {
    matcher: [
        // Skip API, Next internals, and any static file in /public
        // (anything with a file extension). Without the extension escape, /logo.svg
        // and friends get auth-redirected to /login and serve HTML instead of the asset.
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)",
    ],
};
