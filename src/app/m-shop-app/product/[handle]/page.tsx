import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import AppProductView from "@/modules/external/shopApp/AppProductView";
import { loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";
import { loadSimilarProducts, SIMILAR_PRODUCTS_LIMIT } from "@/shared/lib/shop/similarProducts";

// Similar products for one product, kept 5 minutes like the catalogue itself
// (the product id is part of the cache key).
const loadSimilarCached = unstable_cache(
    (id: number, groupId: number | null) => loadSimilarProducts({ id, groupId }, SIMILAR_PRODUCTS_LIMIT),
    ["shop-app:similar"],
    { revalidate: 300 }
);

/**
 * The app's product page. The product comes out of the cached catalogue — the
 * same list the customer can browse — so opening a product reads nothing from
 * the database, and a product the shop hides is not reachable here either.
 */
export default async function CustomerAppProductPage({ params }: { params: Promise<{ handle: string }> }) {
    const handle = decodeURIComponent((await params).handle);
    const products = await loadStorefrontProductsCached();
    const product = products.find((p) => p.slug === handle || String(p.id) === handle);
    if (!product) notFound();
    const similar = await loadSimilarCached(product.id, product.groupId);
    return <AppProductView product={product} similar={similar} />;
}
