import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { productPath } from "@/shared/lib/shop/productPublic";
import { loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";
import type { PostProduct } from "@/modules/campaigns/lib/post";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * GET /api/campaigns/posts/products — the products a post can start from: what
 * the shop shows customers (the same 5-minute list the customer app reads),
 * trimmed to what the picker and the starting caption need. The composer reads
 * it once per page, only when "From a product" is used.
 */

const BLURB_MAX = 280;

/** The description's first paragraph, cut at a word near BLURB_MAX. */
function blurb(description: string | null): string | null {
    const first = description?.trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim();
    if (!first) return null;
    if (first.length <= BLURB_MAX) return first;
    const cut = first.slice(0, BLURB_MAX);
    return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : BLURB_MAX)}…`;
}

export async function GET() {
    const { response } = await requirePostsPage();
    if (response) return response;

    try {
        const products: PostProduct[] = (await loadStorefrontProductsCached()).map((p) => ({
            id: p.id,
            name: p.displayName,
            category: p.category,
            path: productPath(p),
            pricePaise: p.pricePaise,
            mrpPaise: p.mrpPaise,
            imageUrl: p.galleryUrls[0] ?? p.imageUrl,
            blurb: blurb(p.description),
            inStock: p.stockStatus === "in_stock",
        }));
        return NextResponse.json({ products });
    } catch (e) {
        return handleApiError(e, "Failed to load the shop products");
    }
}
