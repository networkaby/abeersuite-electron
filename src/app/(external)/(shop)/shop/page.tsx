import { loadStorefrontProducts } from "@/shared/lib/shop/storefrontProducts";
import ShopPageBanner from "@/modules/external/shop/ShopPageBanner";
import TrustStrip from "@/modules/external/store/TrustStrip";
import BrandStrip from "@/modules/external/store/BrandStrip";
import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";
import { loadShopAdContext } from "@/shared/lib/shop/adContext";

export default async function ShopCatalogPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; category?: string; collection?: string; adPreview?: string }>;
}) {
    const sp = await searchParams;
    const initialCategory = sp.category && sp.category !== "" ? sp.category : "all";
    const initialCollection = sp.collection?.trim() || undefined;
    const [products, adContext] = await Promise.all([loadStorefrontProducts(), loadShopAdContext(sp)]);
    const cats = [...new Set(products.map((p) => p.category))];
    const categoryCount = new Set(cats.filter(Boolean)).size;

    // Banner pills = collections (office Category), biggest first.
    const collectionCounts = new Map<string, number>();
    for (const p of products) {
        for (const c of new Set(p.collections)) collectionCounts.set(c, (collectionCounts.get(c) ?? 0) + 1);
    }
    const collectionPills = [...collectionCounts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return (
        <>
            <ShopPageBanner
                productCount={products.length}
                categoryCount={categoryCount}
                collectionPills={collectionPills}
                activeQuery={sp.q?.trim() || undefined}
            />
            <TrustStrip />
            <ShopCatalogClient
                products={products}
                allCategories={cats}
                initialQuery={sp.q ?? ""}
                initialCategory={initialCategory}
                initialCollection={initialCollection}
                adContext={adContext}
            />
            <BrandStrip />
        </>
    );
}
