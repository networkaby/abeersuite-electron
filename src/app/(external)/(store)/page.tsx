import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic as shopProductToPublic, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { shopQualification } from "@/modules/ecommerce/lib/shopQualification";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { STORE_PAGE_HEADING } from "@/shared/lib/shop/storeContent";
import {
    resolveHomeSections,
    activeSlides,
    toHeroSlide,
    toPromoBanner,
    type HomeSectionInstance,
} from "@/shared/lib/shop/homeLayout";
import { loadHomeLayout } from "@/shared/lib/shop/loadHomeLayout";
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

type PageData = {
    categoryEntries: { name: string; count: number; fallbackImageUrl: string | null }[];
    featured: ShopProductPublic[];
    deals: ShopProductPublic[];
    dealOfTheDay: ShopProductPublic | null;
    products: ShopProductPublic[];
    allCategories: string[];
    query: string;
    initialCategory: string;
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
                    categories={data.categoryEntries}
                    eyebrow={content.eyebrow}
                    title={content.title}
                    subtitle={content.subtitle}
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
            return <BrandStrip eyebrow={content.eyebrow} title={content.title} />;
        case "fullCatalog":
            return (
                <ShopCatalogClient
                    products={data.products}
                    allCategories={data.allCategories}
                    initialQuery={data.query}
                    initialCategory={data.initialCategory}
                    title={content.title}
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
    searchParams: Promise<{ q?: string; category?: string }>;
}) {
    const sp = await searchParams;
    const initialCategory = sp.category && sp.category !== "" ? sp.category : "all";

    const [bands, rules, policy, groupIndex, instances] = await Promise.all([
        loadBarcodeBands(),
        loadShopPublishRules(),
        loadShopStockPolicy(),
        loadShopGroupIndex(),
        loadHomeLayout(),
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

    const data: PageData = {
        categoryEntries,
        featured: pickFeatured(products),
        deals: pickDeals(products),
        dealOfTheDay: pickDealOfTheDay(products),
        products,
        allCategories,
        query: sp.q ?? "",
        initialCategory,
    };

    const todayIso = businessTodayIso();
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
