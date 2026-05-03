import { auth } from "@/auth";
import { NextResponse } from "next/server";

function isPublicPath(pathname: string): boolean {
    if (pathname === "/" || pathname === "/login") return true;
    if (pathname.startsWith("/portal")) return true;
    if (pathname.startsWith("/shop")) return true;
    if (pathname === "/public/login") return true;
    return false;
}

export default auth((req) => {
    const { pathname } = req.nextUrl;
    const session = req.auth;
    const isAuthenticated = !!session?.user;
    const user = session?.user as { kind?: string } | undefined;
    const isCustomer = user?.kind === "customer";

    if (isAuthenticated && isCustomer && pathname === "/login") {
        return NextResponse.redirect(new URL("/portal", req.url));
    }

    if (isAuthenticated && isCustomer && !isPublicPath(pathname)) {
        return NextResponse.redirect(new URL("/portal", req.url));
    }

    if (!isAuthenticated) {
        if (!isPublicPath(pathname)) {
            const signIn = new URL("/portal/login", req.url);
            signIn.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
            return NextResponse.redirect(signIn);
        }
        return NextResponse.next();
    }

    if (pathname === "/login") {
        return NextResponse.redirect(new URL("/office/assignments", req.url));
    }

    if (pathname === "/portal/login" && isCustomer) {
        return NextResponse.redirect(new URL("/portal", req.url));
    }

    return NextResponse.next();
});

export const config = {
    matcher: ["/((?!api|_next/static|_next/image|favicon.ico|receipt).*)"],
};
