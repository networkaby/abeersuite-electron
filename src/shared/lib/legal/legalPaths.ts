/**
 * The legal-page slugs, kept in their own tiny module so `proxy.ts` can treat
 * them as public without pulling the full policy prose into the proxy bundle.
 *
 * These pages MUST stay reachable without signing in — Razorpay's activation
 * review and Google's OAuth verification both fetch them anonymously.
 *
 * Adding a policy? Add the slug here, add the route under
 * `src/app/(external)/(legal)/<slug>/`, and add the doc in `legalContent.ts`.
 * The proxy allowlist then updates itself.
 */

/** Order matters — this is the order the links appear in the footer. */
export const LEGAL_SLUGS = ["terms", "privacy", "refunds", "shipping"] as const;

export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const LEGAL_PATHS: readonly string[] = LEGAL_SLUGS.map((slug) => `/${slug}`);

export function isLegalPath(pathname: string): boolean {
    return LEGAL_PATHS.includes(pathname);
}
