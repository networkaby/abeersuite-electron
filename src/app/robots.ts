import type { MetadataRoute } from "next";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { INDEXABLE } from "@/shared/lib/appMode";

/**
 * One robots.txt, two answers — which one depends on APP_MODE.
 *
 * The internal build is a staff tool that happens to be on the public internet.
 * Nothing there is meant to be found in a search result, so it disallows
 * everything and offers no sitemap.
 *
 * This is a crawler instruction, not a security control: a disallowed path is
 * still reachable by anyone who types it. Authentication remains the thing that
 * keeps staff pages private.
 */

/**
 * Public-build paths that must stay out of the index.
 *
 * Mirrors the route groups: `(protected)` is staff-only, `(external)/portal` is
 * a signed-in customer area, and the print routes render one document each for
 * a specific order or ticket — nothing a searcher could ever want.
 */
const PRIVATE_PATHS = [
    "/office",
    "/staff",
    "/vouchers",
    "/lab",
    "/api",
    "/portal",
    "/receipt",
    "/shipping-label",
    "/shipping-slip",
];

export default function robots(): MetadataRoute.Robots {
    if (!INDEXABLE) {
        return {
            rules: { userAgent: "*", disallow: "/" },
        };
    }

    return {
        rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
        sitemap: `${COMPANY_DETAILS.sites.shop}/sitemap.xml`,
    };
}
