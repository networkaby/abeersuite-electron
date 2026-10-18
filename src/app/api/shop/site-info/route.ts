import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { loadStorefrontProductsCached, pickDeals } from "@/shared/lib/shop/storefrontProducts";
import { productPath } from "@/shared/lib/shop/productPublic";

/**
 * Read-only feed for the company site (networkservice.in, a separate repo): the
 * business details and today's deals, so neither is typed twice. Anonymous and
 * public — it returns only what the storefront already shows. Products come from
 * the 5-minute cached list and the CDN holds the answer as long again, so the
 * company site's visitors cost no database reads.
 */
export async function GET() {
    try {
        const deals = pickDeals(await loadStorefrontProductsCached(), 6).map((p) => ({
            name: p.displayName,
            url: `${COMPANY_DETAILS.sites.shop}${productPath(p)}`,
            imageUrl: p.galleryUrls[0] ?? p.imageUrl,
            pricePaise: p.pricePaise,
            mrpPaise: p.mrpPaise,
        }));
        const { brandName, contact, address, hours, openingHours, sites } = COMPANY_DETAILS;
        return NextResponse.json(
            { business: { brandName, contact, address, hours, openingHours, sites }, deals },
            { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
        );
    } catch (e) {
        return handleApiError(e, "Failed to load site info");
    }
}
