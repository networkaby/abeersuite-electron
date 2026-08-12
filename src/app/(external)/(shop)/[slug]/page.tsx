import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic as shopProductToPublic, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { shopQualification, storefrontQualifiable } from "@/modules/ecommerce/lib/shopQualification";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";
import { invProductDb } from "@/shared/types/inventoryTypes";
import ShopRemoteImage from "@/modules/external/shop/ShopRemoteImage";
import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";
import { ChevronRight } from "lucide-react";

/**
 * Root-level brand page ("/hp") — the first slug-registry-style page, ahead
 * of the full `ShopSlug` catch-all in PROJECT_BRAIN's Plan 1. Only brands
 * claim this level today; a category/group catch-all at the same URL depth
 * would need to resolve slug collisions before it can share this route.
 */
const loadBrandWithProducts = cache(async (slug: string) => {
    const brand = await prisma.invBrand.findFirst({
        where: { slug, isActive: true },
        select: { id: true, name: true, slug: true, imageUrl: true, description: true },
    });
    if (!brand) return null;

    const [bands, rules, policy, groupIndex] = await Promise.all([
        loadBarcodeBands(),
        loadShopPublishRules(),
        loadShopStockPolicy(),
        loadShopGroupIndex(),
    ]);
    const rows = await invProductDb(prisma).findMany({
        where: { brandId: brand.id, isListedInShop: true, isActive: true },
        include: { category: { select: { name: true } } },
        orderBy: { id: "asc" },
    });
    const products: ShopProductPublic[] = rows
        .map((p) => ({ p, avail: resolveAvailability(p.stock, p.allowBackorder, policy) }))
        .filter(({ avail }) => avail.visible)
        .map(({ p, avail }) => ({ p, pub: shopProductToPublic(p, { bands, avail, groupIndex }) }))
        .filter(({ p, pub }) => shopQualification(storefrontQualifiable(p, pub), rules).qualified)
        .map(({ pub }) => pub);

    return { brand, products };
});

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const data = await loadBrandWithProducts(slug);
    if (!data) return { title: "Brand" };
    const { brand } = data;
    return {
        title: `${brand.name} products`,
        description: brand.description ?? `Shop ${brand.name} products.`,
        alternates: { canonical: `/${brand.slug}` },
    };
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const data = await loadBrandWithProducts(slug);
    if (!data) notFound();
    const { brand, products } = data;

    const allCategories = [...new Set(products.map((p) => p.category))];

    return (
        <main className="mx-auto max-w-6xl px-3 py-3 sm:py-6">
            <nav className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
                <Link href="/shop" className="hover:text-foreground">
                    Shop
                </Link>
                <ChevronRight className="size-4 opacity-60" />
                <span className="text-foreground font-medium">{brand.name}</span>
            </nav>

            <div className="mb-8 flex items-center gap-4">
                {brand.imageUrl ? (
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-card p-2">
                        <ShopRemoteImage
                            src={brand.imageUrl}
                            alt={brand.name}
                            width={56}
                            height={56}
                            unoptimized
                            className="h-full w-auto object-contain"
                        />
                    </div>
                ) : null}
                <div>
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{brand.name}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {products.length} product{products.length === 1 ? "" : "s"}
                        {brand.description ? ` · ${brand.description}` : ""}
                    </p>
                </div>
            </div>

            {products.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                    No {brand.name} products are listed right now.
                </p>
            ) : (
                <ShopCatalogClient
                    products={products}
                    allCategories={allCategories}
                    initialQuery=""
                    initialCategory="all"
                />
            )}
        </main>
    );
}
