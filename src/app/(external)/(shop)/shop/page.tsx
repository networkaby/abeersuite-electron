import { loadStorefrontProducts, storefrontCategories } from "@/shared/lib/shop/storefrontProducts";
import ShopPageBanner from "@/modules/external/shop/ShopPageBanner";
import TrustStrip from "@/modules/external/store/TrustStrip";
import BrandStrip from "@/modules/external/store/BrandStrip";
import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";
import { loadShopAdContext } from "@/shared/lib/shop/adContext";

export default async function ShopCatalogPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; category?: string; adPreview?: string }>;
}) {
    const sp = await searchParams;
    const initialCategory = sp.category && sp.category !== "" ? sp.category : "all";
    const [products, adContext] = await Promise.all([loadStorefrontProducts(), loadShopAdContext(sp)]);
    const cats = [...new Set(products.map((p) => p.category))];
    const categoryPills = storefrontCategories(products).map(({ name, count }) => ({ name, count }));

    return (
        <>
            <ShopPageBanner
                productCount={products.length}
                categoryPills={categoryPills}
                activeQuery={sp.q?.trim() || undefined}
            />
            <TrustStrip />
            <ShopCatalogClient
                products={products}
                allCategories={cats}
                initialQuery={sp.q ?? ""}
                initialCategory={initialCategory}
                adContext={adContext}
            />
            <BrandStrip />
        </>
    );
}
