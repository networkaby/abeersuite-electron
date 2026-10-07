import AppTopBar from "@/modules/external/shopApp/AppTopBar";
import AppHeroSwiper from "@/modules/external/shopApp/AppHeroSwiper";
import AppCategoryGrid from "@/modules/external/shopApp/AppCategoryGrid";
import AppProductRail from "@/modules/external/shopApp/AppProductRail";
import { loadStorefrontProducts, pickDeals, pickFeatured, storefrontCategories } from "@/shared/lib/shop/storefrontProducts";
import { loadHomeLayout } from "@/shared/lib/shop/loadHomeLayout";
import { activeSlides, resolveHomeSections, toHeroSlide } from "@/shared/lib/shop/homeLayout";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { SHOP_NATIVE_HOME } from "@/shared/lib/device/shopApp";

// The same for every customer: rebuilt at most every 5 minutes, so opening the
// app costs no database read. A price or stock change shows within 5 minutes.
export const revalidate = 300;

/**
 * App Home: banners, categories, then today's deals and top picks. The banners
 * are the website hero's own slides (Customize Home), so one edit updates both.
 */
export default async function CustomerAppHomePage() {
    const [products, instances] = await Promise.all([loadStorefrontProducts(), loadHomeLayout()]);
    const todayIso = businessTodayIso();
    const hero = resolveHomeSections(instances, todayIso).find((i) => i.type === "hero");
    const slides = hero ? activeSlides(hero.content, todayIso).map(toHeroSlide) : [];

    return (
        <>
            <AppTopBar />
            <main className="space-y-6 py-4">
                <AppHeroSwiper slides={slides} />
                <AppCategoryGrid categories={storefrontCategories(products)} limit={8} allHref={`${SHOP_NATIVE_HOME}/categories`} />
                <AppProductRail title="Today's deals" products={pickDeals(products)} />
                <AppProductRail title="Top picks" products={pickFeatured(products)} />
            </main>
        </>
    );
}
