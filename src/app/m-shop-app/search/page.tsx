import AppSearch from "@/modules/external/shopApp/AppSearch";
import { loadStorefrontProductsCached, storefrontCategories } from "@/shared/lib/shop/storefrontProducts";

/** Full-screen search: recent searches, then suggestions as the customer types. */
export default async function CustomerAppSearchPage() {
    const products = await loadStorefrontProductsCached();
    return (
        <AppSearch
            // Only what a suggestion shows — not the whole product.
            products={products.map((p) => ({ id: p.id, slug: p.slug, displayName: p.displayName, category: p.category, description: p.description }))}
            categories={storefrontCategories(products).map((c) => c.name)}
        />
    );
}
