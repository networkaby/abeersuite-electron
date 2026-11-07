import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";
import { loadBrowseTiles } from "@/shared/lib/shop/browseTiles";
import { compatibleModels } from "@/shared/lib/shop/compatibility";

/**
 * What the website search box suggests from, fetched once when the shopper
 * first touches the box — then every keystroke is answered in the browser,
 * never a server call per letter. Slim on purpose: only what a suggestion row
 * shows. Built from the 5-minute cached catalogue and tiles, and cached at the
 * edge for the same 5 minutes, so it costs no database read per visitor.
 */
export async function GET() {
    try {
        const [products, tiles] = await Promise.all([loadStorefrontProductsCached(), loadBrowseTiles()]);
        const body = {
            products: products.map((p) => ({
                id: p.id,
                slug: p.slug,
                displayName: p.displayName,
                category: p.category,
                description: p.description ? p.description.slice(0, 200) : null,
                // Compatible models, so "Smart Tank 580 head" suggests the head (compatibility.ts).
                fits: compatibleModels(p).join(" ") || null,
                pricePaise: p.pricePaise,
                mrpPaise: p.mrpPaise,
                imageUrl: p.galleryUrls[0] ?? p.imageUrl ?? null,
            })),
            categories: tiles.categories.map(({ name, href, count }) => ({ name, href, count })),
            collections: tiles.collections.map(({ name, href, count }) => ({ name, href, count })),
            brands: tiles.brands.map(({ name, href, count }) => ({ name, href, count })),
        };
        return NextResponse.json(body, {
            headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
        });
    } catch (e) {
        return handleApiError(e, "Failed to load search");
    }
}
