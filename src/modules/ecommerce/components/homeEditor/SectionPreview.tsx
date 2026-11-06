"use client";

import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import {
    toHeroSlide,
    toPromoBanner,
    homeSectionTypeDef,
    type BannerSlide,
    type HomeSectionInstance,
} from "@/shared/lib/shop/homeLayout";
import HeroCarousel from "@/modules/external/store/HeroCarousel";
import PromoBanners from "@/modules/external/store/PromoBanners";
import TrustStrip from "@/modules/external/store/TrustStrip";
import CategoryShowcase from "@/modules/external/store/CategoryShowcase";
import { HOME_BRAND_LIMIT, HOME_TILE_LIMIT } from "@/shared/lib/shop/homeLayout";
import DealOfTheDay from "@/modules/external/store/DealOfTheDay";
import BrandStripView, { type BrandStripBrand } from "@/modules/external/store/BrandStripView";
import ProductRail from "@/modules/external/shop/ProductRail";
import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";

export type PreviewData = {
    products: ShopProductPublic[];
    brands: BrandStripBrand[];
};

function discountPctOf(p: ShopProductPublic): number {
    if (!p.mrpPaise || p.mrpPaise <= p.pricePaise) return 0;
    return (p.mrpPaise - p.pricePaise) / p.mrpPaise;
}

// Mirrors the storefront page's own pick functions so the preview shows the
// same products the live page would choose for each rail kind.
function pickFeatured(products: ShopProductPublic[], n = 8) {
    return [...products].filter((p) => p.badge).concat(products.filter((p) => !p.badge)).slice(0, n);
}
function pickDeals(products: ShopProductPublic[], n = 8) {
    return [...products]
        .filter((p) => discountPctOf(p) > 0)
        .sort((a, b) => discountPctOf(b) - discountPctOf(a))
        .slice(0, n);
}

function NotWired({ label }: { label: string }) {
    return (
        <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
            <div className="space-y-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">
                    Not wired to real data yet — nothing renders on the storefront.
                </p>
            </div>
        </div>
    );
}

/**
 * Renders one section instance exactly as the storefront would, using real
 * catalogue data fetched by the parent.
 *
 * Deliberately ignores `enabled`, `sectionNo`, `priority`, `startAt`/`endAt` —
 * this is the "what does this section look like" view, so a switched-off or
 * out-of-season section can still be designed and checked here instead of
 * being experimented with on the live site.
 */
export default function SectionPreview({ inst, data }: { inst: HomeSectionInstance; data: PreviewData }) {
    const { content } = inst;
    const def = homeSectionTypeDef(inst.type);

    if (def.kind === "stub") return <NotWired label={def.label} />;

    // Preview shows EVERY slide the section owns, including ones outside their
    // display period — this is the "what does this section look like" view, so
    // a seasonal slide can still be designed and checked off-season. Slides
    // too empty to render are skipped, same as the storefront would.
    const renderable = (content.slides ?? []).filter((s: BannerSlide) => s.title && s.imageUrl);

    switch (inst.type) {
        case "hero": {
            if (renderable.length === 0) return <NotWired label="Add a slide with a title and image to preview" />;
            return <HeroCarousel slides={renderable.map(toHeroSlide)} />;
        }
        case "promoBanner":
        case "shopByNeed":
        case "serviceBlock":
        case "storeLocator":
        case "whatsappStrip": {
            if (renderable.length === 0) return <NotWired label="Add a banner with a title and image to preview" />;
            return <PromoBanners banners={renderable.map(toPromoBanner)} columns={content.columns ?? 1} />;
        }
        case "trustStrip":
            return <TrustStrip items={content.items} />;
        case "categoryShowcase": {
            const categories = [...new Set(data.products.map((p) => p.category))]
                .map((name) => {
                    const inCat = data.products.filter((p) => p.category === name);
                    return {
                        name,
                        count: inCat.length,
                        fallbackImageUrl: inCat[0]?.galleryUrls?.[0] ?? inCat[0]?.imageUrl ?? null,
                    };
                })
                .sort((a, b) => b.count - a.count)
                .slice(0, content.limit ?? HOME_TILE_LIMIT);
            return (
                <CategoryShowcase
                    categories={categories}
                    moreHref="#"
                    moreLabel="More categories"
                    eyebrow={content.eyebrow}
                    title={content.title}
                    subtitle={content.subtitle}
                />
            );
        }
        case "collectionShowcase": {
            const counts = new Map<string, { count: number; img: string | null }>();
            for (const p of data.products) {
                for (const c of p.collections) {
                    const cur = counts.get(c) ?? { count: 0, img: null };
                    counts.set(c, { count: cur.count + 1, img: cur.img ?? p.galleryUrls?.[0] ?? p.imageUrl ?? null });
                }
            }
            const collections = [...counts]
                .map(([name, v]) => ({ name, count: v.count, fallbackImageUrl: v.img }))
                .sort((a, b) => b.count - a.count)
                .slice(0, content.limit ?? HOME_TILE_LIMIT);
            return (
                <CategoryShowcase
                    categories={collections}
                    eyebrow={content.eyebrow ?? "Collections"}
                    title={content.title ?? "Shop by collection"}
                    subtitle={content.subtitle ?? "Ready-made picks for how you use them."}
                    moreHref="#"
                    moreLabel="More collections"
                />
            );
        }
        case "productRail": {
            const products =
                content.railKind === "deals"
                    ? pickDeals(data.products)
                    : content.railKind === "featured"
                      ? pickFeatured(data.products)
                      : null;
            if (!products) return <NotWired label="This picking rule isn't wired up yet" />;
            return (
                <ProductRail
                    id={`preview-${inst.id}`}
                    eyebrow={content.eyebrow}
                    title={content.title ?? "Products"}
                    subtitle={content.subtitle}
                    products={products}
                    accent={content.accent === "amber" ? "primary" : (content.accent ?? "primary")}
                />
            );
        }
        case "dealOfTheDay": {
            const top = [...data.products].sort((a, b) => discountPctOf(b) - discountPctOf(a))[0] ?? null;
            return <DealOfTheDay product={top} eyebrow={content.eyebrow} title={content.title} />;
        }
        case "brandStrip":
            return (
                <BrandStripView
                    brands={data.brands.slice(0, content.limit ?? HOME_BRAND_LIMIT)}
                    eyebrow={content.eyebrow}
                    title={content.title}
                    moreHref={data.brands.length > (content.limit ?? HOME_BRAND_LIMIT) ? "#" : undefined}
                />
            );
        case "fullCatalog":
            return (
                <ShopCatalogClient
                    products={data.products}
                    allCategories={[...new Set(data.products.map((p) => p.category))]}
                    initialQuery=""
                    initialCategory="all"
                    title={content.title}
                />
            );
        default:
            return <NotWired label={def.label} />;
    }
}
