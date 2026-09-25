// ── Free-route allow-list ────────────────────────────────────────────────────
// Routes a user without any operational position can still reach. Anything
// outside this list requires authority (which a position grants). Used by
// `src/app/(protected)/office/layout.tsx` to redirect position-less users to
// `/office/welcome` and to let them keep using their portal and the social
// wall in the meantime.
//
// Convention: match by prefix. `/office/welcome` matches both the exact path
// and any nested route under it. Add new prefixes when a new public-ish area
// is introduced.

export const FREE_ROUTE_PREFIXES = [
    "/office/welcome",
    "/office/me",      // the Employee Portal — your own page
    "/office/user",    // a colleague's profile + wall
] as const;

export function isFreeRoute(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    return FREE_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
