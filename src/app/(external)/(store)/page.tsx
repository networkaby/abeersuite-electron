import { prisma } from "@/lib/prisma";
import { invProductToPublic as shopProductToPublic, type ShopProductPublic } from "@/lib/shop/product-public";
import { invProductDb } from "@/lib/inventory/types";
import { HERO_SLIDES, PROMO_BANNERS_TOP, PROMO_BANNERS_BOTTOM } from "@/lib/shop/store-content";
import HeroCarousel from "@/modules/external/store/HeroCarousel";
import TrustStrip from "@/modules/external/store/TrustStrip";
import CategoryShowcase from "@/modules/external/store/CategoryShowcase";
import PromoBanners from "@/modules/external/store/PromoBanners";
import DealOfTheDay from "@/modules/external/store/DealOfTheDay";
import FeaturedRow from "@/modules/external/store/FeaturedRow";
import BrandStrip from "@/modules/external/store/BrandStrip";
import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";

function pickFeatured(products: ShopProductPublic[], n = 8): ShopProductPublic[] {
    return [...products]
        .filter((p) => p.badge)
        .concat(products.filter((p) => !p.badge))
        .slice(0, n);
}

function discountPctOf(p: ShopProductPublic): number {
    if (!p.mrpPaise || p.mrpPaise <= p.pricePaise) return 0;
    return (p.mrpPaise - p.pricePaise) / p.mrpPaise;
}

function pickDeals(products: ShopProductPublic[], n = 8): ShopProductPublic[] {
    return [...products]
        .filter((p) => discountPctOf(p) > 0)
        .sort((a, b) => discountPctOf(b) - discountPctOf(a))
        .slice(0, n);
}

function pickDealOfTheDay(products: ShopProductPublic[]): ShopProductPublic | null {
    const sorted = [...products].sort((a, b) => discountPctOf(b) - discountPctOf(a));
    return sorted[0] ?? null;
}

export default async function StoreHomePage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; category?: string }>;
}) {
    const sp = await searchParams;
    const initialCategory = sp.category && sp.category !== "" ? sp.category : "all";

    const rows = await invProductDb(prisma).findMany({
        where: { isListedInShop: true, isActive: true },
        include: { category: { select: { name: true } } },
        orderBy: [{ shopCategory: "asc" }, { id: "asc" }],
    });
    const products = rows.map(shopProductToPublic);

    const allCategories = [...new Set(products.map((p) => p.category))];
    const categoryEntries = allCategories
        .map((name) => {
            const inCat = products.filter((p) => p.category === name);
            return {
                name,
                count: inCat.length,
                fallbackImageUrl: inCat[0]?.galleryUrls[0] ?? inCat[0]?.imageUrl ?? null,
            };
        })
        .sort((a, b) => b.count - a.count);

    const featured = pickFeatured(products);
    const deals = pickDeals(products);
    const dealOfTheDay = pickDealOfTheDay(products);

    return (
        <>
            <HeroCarousel slides={HERO_SLIDES} />

            <TrustStrip />

            <CategoryShowcase categories={categoryEntries} />

            <PromoBanners banners={PROMO_BANNERS_TOP} columns={2} />

            <FeaturedRow
                id="featured"
                eyebrow="Trending"
                title="Top picks for you"
                subtitle="Hand-picked best sellers across categories."
                products={featured}
            />

            <DealOfTheDay product={dealOfTheDay} />

            <PromoBanners banners={PROMO_BANNERS_BOTTOM} columns={3} />

            <FeaturedRow
                id="deals"
                eyebrow="Today's deals"
                title="Save big — limited stock"
                subtitle="Biggest discounts right now, sorted by % off."
                products={deals}
                accent="emerald"
            />

            <BrandStrip />

            <ShopCatalogClient
                products={products}
                allCategories={allCategories}
                initialQuery={sp.q ?? ""}
                initialCategory={initialCategory}
            />
        </>
    );
}
