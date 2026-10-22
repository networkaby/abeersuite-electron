import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadShopProduct } from "@/shared/lib/shop/loadShopProduct";
import { loadStorefrontProducts } from "@/shared/lib/shop/storefrontProducts";
import { groupSubtreeIds, loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { resolveShopSlugTarget, type ShopSlugTarget } from "@/shared/lib/shop/shopSlug";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";
import ShopProductPage, { shopProductMetadata } from "@/modules/external/shop/ShopProductPage";
import { loadShopAdContext } from "@/shared/lib/shop/adContext";
import { ChevronRight } from "lucide-react";

/**
 * Every root-level shop page, Flipkart-style — one flat URL space:
 *
 *   /hp-15-laptop     product     (InvProduct.slug, or /123 by id)
 *   /laptops          category    (office Group — and every group under it)
 *   /kids-collection  collection  (office Category)
 *   /hp               brand
 *
 * Tried in that order. `shopSlugClash` stops two rows sharing a slug when
 * they are saved, and app routes (`/shop`, `/portal`, …) always win over this
 * dynamic segment in Next's own routing.
 */

const loadListing = cache(async (target: ShopSlugTarget) => {
    switch (target.kind) {
        case "brand":
            return loadStorefrontProducts({ brandId: target.id });
        case "category":
            return loadStorefrontProducts({ categoryId: target.id });
        case "group":
            return loadStorefrontProducts({ groupIds: groupSubtreeIds(await loadShopGroupIndex(), target.id) });
    }
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const product = (await loadShopProduct(slug, false))?.product;
    if (product) return shopProductMetadata(product);

    const target = await resolveShopSlugTarget(slug);
    if (!target) return { title: "Not found" };
    return {
        title: target.kind === "brand" ? `${target.name} products` : target.name,
        description: target.description ?? `Shop ${target.name}.`,
        alternates: { canonical: `/${target.slug}` },
    };
}

export default async function ShopSlugPage({
    params,
    searchParams,
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ adPreview?: string }>;
}) {
    const { slug } = await params;
    const sp = await searchParams;

    const product = (await loadShopProduct(slug, false))?.product;
    if (product) return <ShopProductPage product={product} handle={slug} searchParams={sp} />;

    const target = await resolveShopSlugTarget(slug);
    if (!target) notFound();
    const [products, adContext] = await Promise.all([loadListing(target), loadShopAdContext(sp)]);

    const allCategories = [...new Set(products.map((p) => p.category))];

    return (
        <main className="mx-auto max-w-6xl px-3 py-3 sm:py-6">
            <nav className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
                <Link href="/shop" className="hover:text-foreground">
                    Shop
                </Link>
                <ChevronRight className="size-4 opacity-60" />
                <span className="text-foreground font-medium">{target.name}</span>
            </nav>

            <div className="mb-8 flex items-center gap-4">
                {target.imageUrl ? (
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-card p-2">
                        <ShopRemoteImage
                            src={target.imageUrl}
                            alt={target.name}
                            width={56}
                            height={56}
                            unoptimized
                            className="h-full w-auto object-contain"
                        />
                    </div>
                ) : null}
                <div>
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{target.name}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {products.length} product{products.length === 1 ? "" : "s"}
                        {target.description ? ` · ${target.description}` : ""}
                    </p>
                </div>
            </div>

            {products.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                    No {target.name} products are listed right now.
                </p>
            ) : (
                <ShopCatalogClient
                    products={products}
                    allCategories={allCategories}
                    initialQuery=""
                    initialCategory="all"
                    adContext={adContext}
                />
            )}
        </main>
    );
}
