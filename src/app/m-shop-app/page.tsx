import AppHomeHeader from "@/modules/external/shopApp/AppHomeHeader";
import AppHeroSwiper from "@/modules/external/shopApp/AppHeroSwiper";
import AppProductRail from "@/modules/external/shopApp/AppProductRail";
import AppRecentlyViewed from "@/modules/external/shopApp/AppRecentlyViewed";
import { BrandRow, CategoryStrip, DealsGrid, HomeSection, ProductGrid } from "@/modules/external/shopApp/AppHomeSections";
import { loadStorefrontProducts, pickDeals, pickFeatured, storefrontCategories } from "@/shared/lib/shop/storefrontProducts";
import { loadShopBrands } from "@/shared/lib/shop/shopBrands";
import { loadHomeLayout } from "@/shared/lib/shop/loadHomeLayout";
import { activeSlides, resolveHomeSections, toHeroSlide } from "@/shared/lib/shop/homeLayout";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { appProductsPath } from "@/modules/external/shopApp/appPaths";

// The same for every customer: rebuilt at most every 5 minutes, so opening the
// app costs no database read. A price or stock change shows within 5 minutes.
export const revalidate = 300;

/**
 * App Home, laid out like Flipkart / Amazon: brand-colour top bar with
 * delivery pincode and search, a swipeable category row, sliding banners,
 * Deals for you (2×2), Top picks, Recently viewed, Shop by brand, then every
 * product as a grid so Home keeps scrolling. The banners are the website hero's
 * own slides (Customize Home), so one edit updates both.
 */
export default async function CustomerAppHomePage() {
    const [products, instances, brands] = await Promise.all([loadStorefrontProducts(), loadHomeLayout(), loadShopBrands()]);
    const todayIso = businessTodayIso();
    const hero = resolveHomeSections(instances, todayIso).find((i) => i.type === "hero");
    const slides = hero ? activeSlides(hero.content, todayIso).map(toHeroSlide) : [];
    const deals = pickDeals(products);
    const picks = pickFeatured(products);

    return (
        // Grey page, white section cards — the usual shopping-app look.
        <div className="min-h-dvh bg-muted/60">
            <AppHomeHeader />
            <CategoryStrip categories={storefrontCategories(products)} />
            <div className="space-y-2 pb-4">
                <div className="bg-background pb-3">
                    <AppHeroSwiper slides={slides} />
                </div>
                {deals.length > 0 && (
                    <HomeSection title="Deals for you" href={appProductsPath()}>
                        <DealsGrid products={deals} />
                    </HomeSection>
                )}
                {picks.length > 0 && (
                    <div className="bg-background py-3">
                        <AppProductRail title="Top picks" products={picks} />
                    </div>
                )}
                <AppRecentlyViewed products={products} />
                {brands.length > 0 && (
                    <HomeSection title="Shop by brand">
                        <BrandRow brands={brands} />
                    </HomeSection>
                )}
                {products.length > 0 && (
                    <HomeSection title="Suggested for you" href={appProductsPath()}>
                        <ProductGrid products={products} />
                    </HomeSection>
                )}
            </div>
        </div>
    );
}
