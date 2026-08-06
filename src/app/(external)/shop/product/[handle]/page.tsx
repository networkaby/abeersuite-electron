import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic as shopProductToPublic, productPath } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";
import { invProductDb } from "@/shared/types/inventoryTypes";
import ProductGallery from "@/modules/external/shop/ProductGallery";
import ProductPurchasePanel from "@/modules/external/shop/ProductPurchasePanel";
import ProductDetailTabs from "@/modules/external/shop/ProductDetailTabs";
import ProductRail from "@/modules/external/shop/ProductRail";
import { loadSimilarProducts } from "@/shared/lib/shop/similarProducts";
import { ChevronRight } from "lucide-react";
import JsonLd from "@/shared/components/JsonLd";
import { buildProductLd } from "@/shared/lib/seo/jsonLd";

/**
 * Load one product in its storefront shape.
 *
 * Bands and stock policy are passed in for the same reason the store home and
 * /shop pass them: the price a customer sees must be the printed barcode tag,
 * identical on the card, this page, the receipt and the shelf label. Without
 * them the mapper falls back to the effective sale price, and the card and the
 * product page quote two different numbers for the same item.
 *
 * `cache()` dedupes the whole thing across generateMetadata and the page body,
 * which both need the product — one render, one set of queries.
 */
const loadProduct = cache(async (handle: string) => {
    const decoded = decodeURIComponent(handle);
    const db = invProductDb(prisma);
    const [bands, policy, groupIndex] = await Promise.all([
        loadBarcodeBands(),
        loadShopStockPolicy(),
        loadShopGroupIndex(),
    ]);

    const where = /^\d+$/.test(decoded)
        ? { id: parseInt(decoded, 10), isListedInShop: true, isActive: true }
        : { slug: decoded, isListedInShop: true, isActive: true };

    const p = await db.findFirst({
        where,
        include: { category: { select: { name: true } } },
    });
    if (!p) return null;

    // Same visibility gate as the listing pages. A product the catalogue hides
    // must not stay reachable (and indexable) on its own URL.
    const avail = resolveAvailability(p.stock, p.allowBackorder, policy, p.reserved);
    if (!avail.visible) return null;

    return shopProductToPublic(p, { bands, avail, groupIndex });
});

export async function generateMetadata({
    params,
}: {
    params: Promise<{ handle: string }>;
}): Promise<Metadata> {
    const { handle } = await params;
    const p = await loadProduct(handle);
    if (!p) return { title: "Product" };

    const description = p.subheading ?? p.description ?? undefined;
    // A product is reachable by numeric id AND by slug. Point both at the slug
    // form so the two URLs are not indexed as two products.
    const canonical = productPath(p);
    const image = p.galleryUrls[0] ?? p.imageUrl ?? undefined;

    return {
        // Just the product name — the root template appends the brand, and
        // "· Shop" in between only eats characters Google will truncate.
        title: p.name,
        description,
        alternates: { canonical },
        openGraph: {
            type: "website",
            title: p.name,
            description,
            url: canonical,
            // The product's own photo beats the generic store card here — this
            // is the one page where the share preview should show the thing
            // being sold.
            images: image ? [image] : undefined,
        },
    };
}

export default async function ShopProductPage({ params }: { params: Promise<{ handle: string }> }) {
    const { handle } = await params;
    const product = await loadProduct(handle);
    if (!product) notFound();

    // Similar = same office GROUP, widening up the ancestor chain only if the
    // leaf is thin. The previous implementation matched on the group's ROOT,
    // which pooled every mouse, keyboard, cabinet and monitor together (all root
    // at "IT Products") and fetched them unbounded — now that the catalogue is
    // actually classified that is 80+ cards on a single product page.
    const similar = await loadSimilarProducts({ id: product.id, groupId: product.groupId });

    const canonicalPath = productPath(product);

    return (
        <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
            {/* Built from the same `product` object the page renders, so the
                offer price and availability always match what the customer sees. */}
            <JsonLd data={buildProductLd(product)} />

            {/* Full group chain, department-first: Shop › IT Products › Mouse › …
                `categoryPath` arrives nearest-ancestor-first, so it is reversed
                to read top-down the way a breadcrumb must. */}
            <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground mb-8">
                <Link href="/shop" className="hover:text-foreground">
                    Shop
                </Link>
                {[...product.categoryPath].reverse().map((name) => (
                    <span key={name} className="flex items-center gap-1">
                        <ChevronRight className="size-4 opacity-60" />
                        <Link
                            href={`/shop?category=${encodeURIComponent(name)}`}
                            className="hover:text-foreground"
                        >
                            {name}
                        </Link>
                    </span>
                ))}
                <ChevronRight className="size-4 opacity-60" />
                <Link href={`/shop?category=${encodeURIComponent(product.category)}`} className="hover:text-foreground">
                    {product.category}
                </Link>
                <ChevronRight className="size-4 opacity-60" />
                <span className="text-foreground font-medium line-clamp-1">{product.name}</span>
            </nav>

            {product.slug && /^\d+$/.test(decodeURIComponent(handle)) ? (
                <p className="mb-4 text-xs text-muted-foreground">
                    Permalink:{" "}
                    <Link href={canonicalPath} className="text-primary underline">
                        {canonicalPath}
                    </Link>
                </p>
            ) : null}

            <div className="grid gap-10 lg:grid-cols-2 lg:gap-12 items-start">
                <ProductGallery urls={product.galleryUrls} alt={product.name} />
                <ProductPurchasePanel product={product} />
            </div>

            <ProductDetailTabs product={product} />

            <ProductRail
                className="mt-20 border-t border-border/80 pt-12"
                bordered={false}
                eyebrow="Similar products"
                title="More like this"
                subtitle={`Other items in ${product.category}`}
                products={similar}
                seeAllHref={`/shop?category=${encodeURIComponent(product.category)}`}
                seeAllLabel={`See all ${product.category}`}
            />
        </main>
    );
}
