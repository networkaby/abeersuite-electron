import type { MetadataRoute } from "next";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { LEGAL_SLUGS } from "@/shared/lib/legal/legalPaths";
import { IS_FULL } from "@/shared/lib/appMode";

/**
 * One sitemap for the whole business.
 *
 * The company site and the store are deployed separately for technical reasons,
 * but to a search engine they are one website — so both are listed here rather
 * than pretending they are unrelated properties.
 *
 * Cross-hostname entries are legitimate because both hostnames sit under the
 * same registrable domain, verified as a single Search Console **Domain
 * property**. If that verification is ever removed, Google will ignore the
 * company-site entries rather than trust them.
 *
 * Only public pages belong here. The customer portal and checkout are
 * signed-in or transactional, so they are deliberately left out.
 */

const { company, shop } = COMPANY_DETAILS.sites;

export default function sitemap(): MetadataRoute.Sitemap {
    // The internal build disallows all crawling (see robots.ts), so offering it
    // a list of pages to crawl would contradict itself.
    if (IS_FULL) return [];

    const now = new Date();

    return [
        // ── Company site — the home page of the business ──
        {
            url: company,
            lastModified: now,
            changeFrequency: "monthly",
            priority: 1,
        },

        // ── Store ──
        {
            url: shop,
            lastModified: now,
            changeFrequency: "daily",
            priority: 0.9,
        },
        {
            url: `${shop}/shop`,
            lastModified: now,
            changeFrequency: "daily",
            priority: 0.8,
        },
        {
            url: `${shop}/login`,
            lastModified: now,
            changeFrequency: "yearly",
            priority: 0.3,
        },

        // ── Policies — one set, covering both hostnames ──
        ...LEGAL_SLUGS.map((slug) => ({
            url: `${shop}/${slug}`,
            lastModified: now,
            changeFrequency: "yearly" as const,
            priority: 0.4,
        })),
    ];
}
