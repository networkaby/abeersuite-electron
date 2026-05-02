import { prisma } from "@/lib/prisma";
import { shopProductToPublic, type ShopProductPublic } from "@/lib/shop/product-public";
import StoreHero from "@/modules/external/store/StoreHero";
import CategoryTiles from "@/modules/external/store/CategoryTiles";
import FeaturedRow from "@/modules/external/store/FeaturedRow";
import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";

function pickFeatured(products: ShopProductPublic[], n = 8): ShopProductPublic[] {
    return [...products]
        .filter((p) => p.badge)
        .concat(products.filter((p) => !p.badge))
        .slice(0, n);
}

function pickDeals(products: ShopProductPublic[], n = 8): ShopProductPublic[] {
    return [...products]
        .filter((p) => p.mrpPaise && p.mrpPaise > p.pricePaise)
        .sort(
            (a, b) =>
                (b.mrpPaise! - b.pricePaise) / b.mrpPaise! -
                (a.mrpPaise! - a.pricePaise) / a.mrpPaise!,
        )
        .slice(0, n);
}

export default async function StoreHomePage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; category?: string }>;
}) {
    const sp = await searchParams;
    const initialCategory = sp.category && sp.category !== "" ? sp.category : "all";

    const rows = await prisma.shopProduct.findMany({
        where: { isActive: true },
        orderBy: [{ category: "asc" }, { id: "asc" }],
    });
    const products = rows.map(shopProductToPublic);

    const allCategories = [...new Set(products.map((p) => p.category))];
    const categoryCounts = allCategories
        .map((name) => ({ name, count: products.filter((p) => p.category === name).length }))
        .sort((a, b) => b.count - a.count);
    const topCategories = categoryCounts.slice(0, 6).map((c) => c.name);

    const featured = pickFeatured(products);
    const deals = pickDeals(products);

    return (
        <>
            <StoreHero topCategories={topCategories} />

            <CategoryTiles categoryCounts={categoryCounts} />

            <FeaturedRow
                id="featured"
                eyebrow="Featured"
                title="Trending picks for you"
                subtitle="Hand-picked best sellers across categories."
                products={featured}
            />

            <FeaturedRow
                id="deals"
                eyebrow="Today's deals"
                title="Save big — limited stock"
                subtitle="Biggest discounts right now, sorted by % off."
                products={deals}
                accent="emerald"
            />

            <ShopCatalogClient
                products={products}
                allCategories={allCategories}
                initialQuery={sp.q ?? ""}
                initialCategory={initialCategory}
            />
        </>
    );
}
