import type { Metadata } from "next";
import Link from "next/link";
import { productPath, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import ProductDetailView from "@/modules/external/shop/ProductDetailView";
import ProductRail from "@/modules/external/shop/ProductRail";
import AdUnit from "@/modules/external/shop/ads/AdUnit";
import { loadSimilarProducts, SIMILAR_PRODUCTS_LIMIT } from "@/shared/lib/shop/similarProducts";
import { loadShopAdContext } from "@/shared/lib/shop/adContext";
import { groupHref, loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { AdPicker } from "@/shared/lib/shop/ads";
import { ChevronRight } from "lucide-react";
import JsonLd from "@/shared/components/JsonLd";
import { buildProductLd } from "@/shared/lib/seo/jsonLd";

// The customer's product page, at the root: `/hp-15-laptop` (or `/123` by id).
// Served by `src/app/(external)/(shop)/[slug]/page.tsx`, which tries a product
// first. Staff preview a product (draft or live) on /preview/product/<id>
// instead, which draws the same ProductDetailView from the same loader.

export function shopProductMetadata(p: ShopProductPublic): Metadata {
    const description = p.description ?? undefined;
    // A product is reachable by numeric id AND by slug. Point both at the slug
    // form so the two URLs are not indexed as two products.
    const canonical = productPath(p);
    const image = p.galleryUrls[0] ?? p.imageUrl ?? undefined;

    return {
        // Just the product name — the root template appends the brand, and
        // "· Shop" in between only eats characters Google will truncate.
        title: p.displayName,
        description,
        alternates: { canonical },
        openGraph: {
            type: "website",
            title: p.displayName,
            description,
            url: canonical,
            // The product's own photo beats the generic store card here — this
            // is the one page where the share preview should show the thing
            // being sold.
            images: image ? [image] : undefined,
        },
    };
}

export default async function ShopProductPage({
    product,
    handle,
    searchParams,
}: {
    product: ShopProductPublic;
    /** The URL segment as typed — an id-form link shows the permalink. */
    handle: string;
    searchParams: { adPreview?: string };
}) {
    // Similar = same office GROUP, widening up the ancestor chain only if the
    // leaf is thin. The previous implementation matched on the group's ROOT,
    // which pooled every mouse, keyboard, cabinet and monitor together (all root
    // at "IT Products") and fetched them unbounded — now that the catalogue is
    // actually classified that is 80+ cards on a single product page.
    // A few rows past the rail's limit are loaded on purpose: they are what a
    // product ad on this page may pick from, since everything in the rail is
    // already on the page and an ad never repeats a visible product.
    const [similarPool, adContext, groupIndex] = await Promise.all([
        loadSimilarProducts({ id: product.id, groupId: product.groupId }, SIMILAR_PRODUCTS_LIMIT + 4),
        loadShopAdContext(searchParams),
        loadShopGroupIndex(),
    ]);
    const similar = similarPool.slice(0, SIMILAR_PRODUCTS_LIMIT);
    const pageAd = new AdPicker(adContext.ads, {
        todayIso: adContext.todayIso,
        products: similarPool,
        onPageProductIds: [product.id, ...similar.map((p) => p.id)],
        seed: adContext.adSeed,
        showPlaceholders: adContext.adPreview,
    }).pick("productPage");

    const canonicalPath = productPath(product);

    // Full group chain, department-first: Shop › IT Products › Mouse › …
    // Ancestors arrive nearest-first, so they are reversed to read top-down.
    // Each crumb goes to the group's own page when it has a slug.
    const group = product.groupId != null ? groupIndex.get(product.groupId) : undefined;
    const ownCrumb = { name: product.category, slug: group?.name === product.category ? group.slug : null };
    const crumbs = [...(group?.ancestors ?? []).slice().reverse(), ownCrumb];
    const categoryHref = groupHref(ownCrumb);

    return (
        <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
            {/* Built from the same `product` object the page renders, so the
                offer price and availability always match what the customer sees. */}
            <JsonLd data={buildProductLd(product)} />

            <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground mb-8">
                <Link href="/shop" className="hover:text-foreground">
                    Shop
                </Link>
                {crumbs.map((c) => (
                    <span key={c.name} className="flex items-center gap-1">
                        <ChevronRight className="size-4 opacity-60" />
                        <Link href={groupHref(c)} className="hover:text-foreground">
                            {c.name}
                        </Link>
                    </span>
                ))}
                <ChevronRight className="size-4 opacity-60" />
                <span className="text-foreground font-medium line-clamp-1">{product.displayName}</span>
            </nav>

            {product.slug && /^\d+$/.test(decodeURIComponent(handle)) ? (
                <p className="mb-4 text-xs text-muted-foreground">
                    Permalink:{" "}
                    <Link href={canonicalPath} className="text-primary underline">
                        {canonicalPath}
                    </Link>
                </p>
            ) : null}

            <ProductDetailView product={product} />

            {pageAd ? <AdUnit ad={pageAd} className="mt-12" /> : null}

            <ProductRail
                className="mt-20 border-t border-border/80 pt-12"
                bordered={false}
                eyebrow="Similar products"
                title="More like this"
                subtitle={`Other items in ${product.category}`}
                products={similar}
                seeAllHref={categoryHref}
                seeAllLabel={`See all ${product.category}`}
            />
        </main>
    );
}
