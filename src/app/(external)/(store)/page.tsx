import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { loadStorefrontProducts, pickDealOfTheDay, pickDeals, pickFeatured } from "@/shared/lib/shop/storefrontProducts";
import { dailyPick, loadBrowseTiles, type BrowseTile, type BrowseTiles } from "@/shared/lib/shop/browseTiles";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { STORE_PAGE_HEADING } from "@/shared/lib/shop/storeContent";
import {
    resolveHomeSections,
    activeSlides,
    HOME_BRAND_LIMIT,
    HOME_TILE_LIMIT,
    toHeroSlide,
    toPromoBanner,
    type HomeSectionInstance,
} from "@/shared/lib/shop/homeLayout";
import { loadHomeLayout } from "@/shared/lib/shop/loadHomeLayout";
import { loadShopAdContext } from "@/shared/lib/shop/adContext";
import type { ShopAdContext } from "@/shared/lib/shop/ads";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import HeroCarousel from "@/modules/external/store/HeroCarousel";
import TrustStrip from "@/modules/external/store/TrustStrip";
import CategoryShowcase from "@/modules/external/store/CategoryShowcase";
import PromoBanners from "@/modules/external/store/PromoBanners";
import DealOfTheDay from "@/modules/external/store/DealOfTheDay";
import ProductRail from "@/modules/external/shop/ProductRail";
import BrandStrip from "@/modules/external/store/BrandStrip";
import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";
import JsonLd from "@/shared/components/JsonLd";
import { buildSiteLd } from "@/shared/lib/seo/jsonLd";

// Title and description live in the layout. Only the canonical belongs here:
// this page reads ?q= and ?category=, so without it every search term and
// category filter is a separately indexable copy of the home page.
export const metadata: Metadata = {
    alternates: { canonical: "/" },
};

/**
 * A section's daily handful: the biggest few stay, the rest rotate by date,
 * so the page feels fresh yet is one stable, cacheable page per day.
 */
function todaysTiles(all: BrowseTile[], limit: number, todayIso: string, salt: string) {
    return dailyPick(all, limit, todayIso, salt).map((t) => ({ name: t.name, count: t.count, fallbackImageUrl: t.imageUrl, href: t.href }));
}

type PageData = {
    /** Every category / collection tile; each section takes its own daily handful. */
    tiles: BrowseTiles;
    featured: ShopProductPublic[];
    deals: ShopProductPublic[];
    dealOfTheDay: ShopProductPublic | null;
    products: ShopProductPublic[];
    allCategories: string[];
    query: string;
    initialCategory: string;
    /** The catalog section fills its row gaps from this, like /shop. */
    adContext: ShopAdContext;
};

/**
 * Render one resolved section. Every section is self-complete: a hero
 * carousel is this one instance's own slide list, a promo strip is its own
 * banner list — nothing is assembled from sibling sections.
 *
 * Slides are filtered by their own display period, so an out-of-season slide
 * drops out of the rotation while the rest keep showing. Every branch is
 * defensive: a section with nothing left to show renders nothing rather than
 * an empty shell, since `resolveHomeSections` only checked the section's own
 * schedule/priority, not whether its content was ever filled in.
 */
function renderSection(inst: HomeSectionInstance, data: PageData, todayIso: string): ReactNode {
    const { content } = inst;
    switch (inst.type) {
        case "hero": {
            const slides = activeSlides(content, todayIso).map(toHeroSlide);
            return slides.length > 0 ? <HeroCarousel slides={slides} /> : null;
        }
        case "promoBanner":
        case "shopByNeed":
        case "serviceBlock":
        case "storeLocator":
        case "whatsappStrip": {
            const banners = activeSlides(content, todayIso).map(toPromoBanner);
            return banners.length > 0 ? <PromoBanners banners={banners} columns={content.columns ?? 1} /> : null;
        }
        case "trustStrip":
            return <TrustStrip items={content.items} />;
        case "categoryShowcase":
            return (
                <CategoryShowcase
                    categories={todaysTiles(data.tiles.categories, content.limit ?? HOME_TILE_LIMIT, todayIso, "categories")}
                    eyebrow={content.eyebrow}
                    title={content.title}
                    subtitle={content.subtitle}
                    moreHref={data.tiles.categories.length > (content.limit ?? HOME_TILE_LIMIT) ? "/shop?view=categories" : undefined}
                    moreLabel="More categories"
                />
            );
        case "collectionShowcase":
            return (
                <CategoryShowcase
                    categories={todaysTiles(data.tiles.collections, content.limit ?? HOME_TILE_LIMIT, todayIso, "collections")}
                    eyebrow={content.eyebrow ?? "Collections"}
                    title={content.title ?? "Shop by collection"}
                    subtitle={content.subtitle ?? "Ready-made picks for how you use them."}
                    moreHref={data.tiles.collections.length > (content.limit ?? HOME_TILE_LIMIT) ? "/shop?view=collections" : undefined}
                    moreLabel="More collections"
                />
            );
        case "productRail": {
            // Only "featured" and "deals" have real product-selection logic
            // wired up so far — other rail kinds are addable/schedulable
            // already, but render nothing until their picking rule exists.
            const products =
                content.railKind === "deals" ? data.deals : content.railKind === "featured" ? data.featured : null;
            if (!products) return null;
            return (
                <ProductRail
                    id={inst.id}
                    eyebrow={content.eyebrow}
                    title={content.title ?? "Products"}
                    subtitle={content.subtitle}
                    products={products}
                    accent={content.accent === "amber" ? "primary" : (content.accent ?? "primary")}
                />
            );
        }
        case "dealOfTheDay":
            return <DealOfTheDay product={data.dealOfTheDay} eyebrow={content.eyebrow} title={content.title} />;
        case "brandStrip":
            return <BrandStrip eyebrow={content.eyebrow} title={content.title} limit={content.limit ?? HOME_BRAND_LIMIT} todayIso={todayIso} />;
        case "fullCatalog":
            return (
                <ShopCatalogClient
                    products={data.products}
                    allCategories={data.allCategories}
                    initialQuery={data.query}
                    initialCategory={data.initialCategory}
                    title={content.title}
                    adContext={data.adContext}
                />
            );
        // Not wired up yet — addable/schedulable in Customize Home, but the
        // data they need (cart, view history, order history, coupons)
        // doesn't exist on the storefront yet.
        case "couponStrip":
        case "wishlistNudge":
        case "recentPurchases":
        case "cartPreview":
        case "abandonedCart":
        case "recentlyViewed":
        case "relatedAlternatives":
            return null;
    }
}

export default async function StoreHomePage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; category?: string; adPreview?: string }>;
}) {
    const sp = await searchParams;
    const initialCategory = sp.category && sp.category !== "" ? sp.category : "all";

    const [products, instances, adContext, tiles] = await Promise.all([
        loadStorefrontProducts(),
        loadHomeLayout(),
        loadShopAdContext(sp),
        loadBrowseTiles(),
    ]);

    const todayIso = businessTodayIso();
    const allCategories = [...new Set(products.map((p) => p.category))];
    const data: PageData = {
        tiles,
        featured: dailyPick(pickFeatured(products, 24), 8, todayIso, "featured", 2),
        deals: pickDeals(products),
        dealOfTheDay: pickDealOfTheDay(products),
        products,
        allCategories,
        query: sp.q ?? "",
        initialCategory,
        adContext,
    };

    const winners = resolveHomeSections(instances, todayIso);

    return (
        <>
            {/* Organization + WebSite + Store, emitted once for the whole site. */}
            <JsonLd data={buildSiteLd()} />

            {/* The page's single h1 — see STORE_PAGE_HEADING for why it is hidden. */}
            <h1 className="sr-only">{STORE_PAGE_HEADING}</h1>

            {winners.map((inst) => (
                <Fragment key={inst.id}>{renderSection(inst, data, todayIso)}</Fragment>
            ))}
        </>
    );
}
