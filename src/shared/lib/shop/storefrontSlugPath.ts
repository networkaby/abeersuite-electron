/**
 * Root-level storefront slug pages — `/hp`, `/dell` — served by
 * `src/app/(external)/(shop)/[slug]/page.tsx` (brands today; categories and
 * collections when the `ShopSlug` registry from PROJECT_BRAIN's Plan 1 lands).
 *
 * `proxy.ts` must treat these as PUBLIC, or a signed-in customer gets bounced
 * to `/portal` and an anonymous visitor to `/login` before the page renders.
 *
 * These slugs are DB rows, so unlike `legalPaths.ts` they cannot be listed.
 * The test is structural and works the other way round: a single-segment path
 * is a storefront slug UNLESS its first segment is one the app itself owns.
 * A slug that matches no brand still reaches the page and 404s there, which is
 * the correct answer for `/nonsense` anyway.
 *
 * ⚠️ ADDING A ROOT-LEVEL APP ROUTE? Add its first segment to RESERVED_SEGMENTS
 * in the same commit. A protected route left out of this list is treated as a
 * storefront slug and stops being auth-gated by the proxy.
 */

/** First path segments owned by the app, never a storefront slug. */
const RESERVED_SEGMENTS = new Set([
    // Protected surfaces — must stay auth-gated.
    "office",
    "vouchers",
    "preview",
    // Auth entry points.
    "login",
    "staff",
    // Public app surfaces with their own routes and proxy rules.
    "portal",
    "shop",
    "public",
    // Non-app surfaces the proxy matcher already skips, listed for completeness
    // so this predicate is correct on its own terms.
    "api",
    "receipt",
    "shipping-slip",
    "shipping-label",
]);

export function isStorefrontSlugPath(pathname: string): boolean {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return false;
    return !RESERVED_SEGMENTS.has(segments[0].toLowerCase());
}
