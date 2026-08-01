import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic as shopProductToPublic, productPath } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";
import { invProductDb } from "@/shared/types/inventoryTypes";
import ProductGallery from "@/modules/external/shop/ProductGallery";
import ProductPurchasePanel from "@/modules/external/shop/ProductPurchasePanel";
import ProductDetailTabs from "@/modules/external/shop/ProductDetailTabs";
import ProductCard from "@/modules/external/shop/ProductCard";
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
    const [bands, policy] = await Promise.all([loadBarcodeBands(), loadShopStockPolicy()]);

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

    return shopProductToPublic(p, bands, avail);
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

    // "You may also like" renders the same ProductCard as the listing pages, so
    // it needs the same bands and availability — otherwise the related strip
    // quotes a different price than the card the customer just clicked.
    const [bands, policy] = await Promise.all([loadBarcodeBands(), loadShopStockPolicy()]);
    const relatedRows = await invProductDb(prisma).findMany({
        where: {
            isListedInShop: true,
            isActive: true,
            shopCategory: product.category,
            NOT: { id: product.id },
        },
        include: { category: { select: { name: true } } },
        orderBy: { id: "asc" },
    });
    const related = relatedRows
        .map((p) => ({ p, avail: resolveAvailability(p.stock, p.allowBackorder, policy, p.reserved) }))
        .filter(({ avail }) => avail.visible)
        .map(({ p, avail }) => shopProductToPublic(p, bands, avail));

    const canonicalPath = productPath(product);

    return (
        <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
            {/* Built from the same `product` object the page renders, so the
                offer price and availability always match what the customer sees. */}
            <JsonLd data={buildProductLd(product)} />

            <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground mb-8">
                <Link href="/shop" className="hover:text-foreground">
                    Shop
                </Link>
                <ChevronRight className="size-4 opacity-60" />
                <Link href={`/shop#cat-${encodeURIComponent(product.category)}`} className="hover:text-foreground">
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

            {related.length > 0 ? (
                <section className="mt-20 border-t border-border/80 pt-12">
                    <h2 className="text-2xl font-bold tracking-tight">You may also like</h2>
                    <p className="text-sm text-muted-foreground mt-1">More in {product.category}</p>
                    <ul className="mt-8 grid auto-rows-fr gap-6 sm:grid-cols-2 xl:grid-cols-4">
                        {related.map((r) => (
                            <li key={r.id} className="flex min-h-0 h-full flex-col">
                                <ProductCard product={r} className="min-h-0 flex-1" />
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </main>
    );
}
