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
import { loadBrowseTiles, type BrowseTile } from "@/shared/lib/shop/browseTiles";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";

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
    const [products, adContext, tiles, groupIndex] = await Promise.all([
        loadListing(target),
        loadShopAdContext(sp),
        loadBrowseTiles(),
        loadShopGroupIndex(),
    ]);
    const related = relatedTiles(target, products, tiles, groupIndex);

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

            {related.length > 0 ? (
                <nav aria-label="Related" className="-mx-1 mb-6 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
                    <span className="shrink-0 self-center px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Related
                    </span>
                    {related.map((t) => (
                        <Link
                            key={t.href}
                            href={t.href}
                            className="shrink-0 rounded-full border border-border/80 bg-background px-3 py-1.5 text-sm font-medium hover:border-primary/50 hover:text-primary"
                        >
                            {t.name}
                        </Link>
                    ))}
                </nav>
            ) : null}

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

/** Most chips in a listing page's "Related" strip. */
const RELATED_MAX = 10;

/**
 * Where to hop sideways from a listing. A category offers its sub-categories
 * and siblings; any listing offers the collections (and categories) its own
 * products also sit in, so a brand page leads into categories and back.
 */
function relatedTiles(
    target: ShopSlugTarget,
    products: ShopProductPublic[],
    tiles: Awaited<ReturnType<typeof loadBrowseTiles>>,
    groupIndex: Awaited<ReturnType<typeof loadShopGroupIndex>>
): BrowseTile[] {
    const out = new Map<string, BrowseTile>();
    const add = (t: BrowseTile | undefined) => {
        if (t && t.name !== target.name && !out.has(t.href)) out.set(t.href, t);
    };
    const tileByName = (list: BrowseTile[], name: string) => list.find((t) => t.name === name);

    if (target.kind === "group") {
        const parentId = groupIndex.get(target.id)?.ancestors[0]?.id ?? null;
        for (const g of groupIndex.values()) {
            const gParent = g.ancestors[0]?.id ?? null;
            const isChild = gParent === target.id;
            const isSibling = parentId != null && gParent === parentId;
            if (isChild || isSibling) add(tileByName(tiles.categories, g.name));
        }
    }
    // Collections (or, for a brand/collection page, categories) the listed products share.
    const tally = new Map<string, number>();
    for (const p of products) {
        const names = target.kind === "group" ? p.collections : [...p.collections, p.category];
        for (const n of new Set(names)) tally.set(n, (tally.get(n) ?? 0) + 1);
    }
    for (const [name] of [...tally].sort((a, b) => b[1] - a[1])) {
        add(tileByName(tiles.collections, name) ?? tileByName(tiles.categories, name));
    }
    return [...out.values()].slice(0, RELATED_MAX);
}
