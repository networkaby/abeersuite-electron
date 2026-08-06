import type { Metadata } from "next";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic as shopProductToPublic, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { shopQualification } from "@/modules/ecommerce/lib/shopQualification";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";
import { invProductDb } from "@/shared/types/inventoryTypes";
import {
    HERO_SLIDES,
    PROMO_BANNERS_TOP,
    PROMO_BANNERS_BOTTOM,
    STORE_PAGE_HEADING,
} from "@/shared/lib/shop/storeContent";
import HeroCarousel from "@/modules/external/store/HeroCarousel";
import TrustStrip from "@/modules/external/store/TrustStrip";
import CategoryShowcase from "@/modules/external/store/CategoryShowcase";
import PromoBanners from "@/modules/external/store/PromoBanners";
import DealOfTheDay from "@/modules/external/store/DealOfTheDay";
import ProductRail from "@/modules/external/shop/ProductRail";
import BrandStrip from "@/modules/external/store/BrandStrip";
// import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";
import JsonLd from "@/shared/components/JsonLd";
import { buildSiteLd } from "@/shared/lib/seo/jsonLd";

// Title and description live in the layout. Only the canonical belongs here:
// this page reads ?q= and ?category=, so without it every search term and
// category filter is a separately indexable copy of the home page.
export const metadata: Metadata = {
    alternates: { canonical: "/" },
};

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
    // const initialCategory = sp.category && sp.category !== "" ? sp.category : "all";

    const [bands, rules, policy, groupIndex] = await Promise.all([
        loadBarcodeBands(),
        loadShopPublishRules(),
        loadShopStockPolicy(),
        loadShopGroupIndex(),
    ]);
    const rows = await invProductDb(prisma).findMany({
        where: { isListedInShop: true, isActive: true },
        include: { category: { select: { name: true } } },
        orderBy: [{ shopCategory: "asc" }, { id: "asc" }],
    });
    const products = rows
        .map((p) => ({ p, avail: resolveAvailability(p.stock, p.allowBackorder, policy) }))
        .filter(({ avail }) => avail.visible)
        .map(({ p, avail }) => shopProductToPublic(p, { bands, avail, groupIndex }))
        .filter((p) => shopQualification(p, rules).qualified);

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
            {/* Organization + WebSite + Store, emitted once for the whole site. */}
            <JsonLd data={buildSiteLd()} />

            {/* The page's single h1 — see STORE_PAGE_HEADING for why it is hidden. */}
            <h1 className="sr-only">{STORE_PAGE_HEADING}</h1>

            <HeroCarousel slides={HERO_SLIDES} />

            <TrustStrip />

            <CategoryShowcase categories={categoryEntries} />

            <PromoBanners banners={PROMO_BANNERS_TOP} columns={2} />

            <ProductRail
                id="featured"
                eyebrow="Trending"
                title="Top picks for you"
                subtitle="Hand-picked best sellers across categories."
                products={featured}
            />

            <DealOfTheDay product={dealOfTheDay} />

            <PromoBanners banners={PROMO_BANNERS_BOTTOM} columns={3} />

            <ProductRail
                id="deals"
                eyebrow="Today's deals"
                title="Save big — limited stock"
                subtitle="Biggest discounts right now, sorted by % off."
                products={deals}
                accent="emerald"
            />

            <BrandStrip />

            {/* <ShopCatalogClient
                products={products}
                allCategories={allCategories}
                initialQuery={sp.q ?? ""}
                initialCategory={initialCategory}
            /> */}
        </>
    );
}
