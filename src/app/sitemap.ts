import type { MetadataRoute } from "next";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { LEGAL_SLUGS } from "@/shared/lib/legal/legalPaths";
import { INDEXABLE } from "@/shared/lib/appMode";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { loadStorefrontProducts } from "@/shared/lib/shop/storefrontProducts";
import { productPath } from "@/shared/lib/shop/productPublic";

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

// Rebuilt at most hourly — it reads the catalogue.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    // The internal build disallows all crawling (see robots.ts), so offering it
    // a list of pages to crawl would contradict itself.
    if (!INDEXABLE) return [];

    // Root-level shop pages (`/hp-15-laptop`, `/laptops`, `/hp`) — only what a
    // customer can actually open: visible products, active masters with a slug.
    const withSlug = { where: { isActive: true, slug: { not: null } }, select: { slug: true } } as const;
    const [products, groups, categories, brands] = await Promise.all([
        loadStorefrontProducts(),
        prisma.invProductGroup.findMany(withSlug),
        prisma.invCategory.findMany(withSlug),
        prisma.invBrand.findMany(withSlug),
    ]);
    const listingSlugs = [...groups, ...categories, ...brands].map((r) => r.slug!);

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

        ...listingSlugs.map((slug) => ({
            url: `${shop}/${slug}`,
            lastModified: now,
            changeFrequency: "daily" as const,
            priority: 0.7,
        })),
        ...products.map((p) => ({
            url: `${shop}${productPath(p)}`,
            lastModified: now,
            changeFrequency: "weekly" as const,
            priority: 0.6,
        })),

        // ── Policies — one set, covering both hostnames ──
        ...LEGAL_SLUGS.map((slug) => ({
            url: `${shop}/${slug}`,
            lastModified: now,
            changeFrequency: "yearly" as const,
            priority: 0.4,
        })),
    ];
}
