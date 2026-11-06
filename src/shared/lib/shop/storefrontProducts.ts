import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic, SHOP_PUBLIC_INCLUDE, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { shopQualification, storefrontQualifiable } from "@/modules/ecommerce/lib/shopQualification";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";

/**
 * Every product a customer may see — the one list behind the home page, /shop,
 * a brand / category / collection page, /api/shop/products and the customer app. Listed + active, then
 * the stock policy (HIDE drops out-of-stock rows), then the publish rules
 * (never a half-built product, even if the listed flag is stale).
 */
export async function loadStorefrontProducts(
    opts: { brandId?: number; categoryId?: number; groupIds?: number[] } = {}
): Promise<ShopProductPublic[]> {
    const narrowed = opts.brandId != null || opts.categoryId != null || opts.groupIds != null;
    const [bands, rules, policy, groupIndex, rows] = await Promise.all([
        loadBarcodeBands(),
        loadShopPublishRules(),
        loadShopStockPolicy(),
        loadShopGroupIndex(),
        prisma.invProduct.findMany({
            where: {
                isListedInShop: true,
                isActive: true,
                ...(opts.brandId != null ? { brandId: opts.brandId } : {}),
                // A collection page lists every product in it, main or extra.
                ...(opts.categoryId != null ? { collections: { some: { categoryId: opts.categoryId } } } : {}),
                ...(opts.groupIds != null ? { groupId: { in: opts.groupIds } } : {}),
            },
            include: SHOP_PUBLIC_INCLUDE,
            orderBy: narrowed ? { id: "asc" } : [{ shopCategory: "asc" }, { id: "asc" }],
        }),
    ]);
    return rows
        .map((p) => ({ p, avail: resolveAvailability(p.stock, p.allowBackorder, policy) }))
        .filter(({ avail }) => avail.visible)
        .map(({ p, avail }) => ({ p, pub: invProductToPublic(p, { bands, avail, groupIndex }) }))
        .filter(({ p, pub }) => shopQualification(storefrontQualifiable(p, pub), rules).qualified)
        .map(({ pub }) => pub);
}

/**
 * The same list, kept for 5 minutes — for the customer app's screens, which
 * read it on every open (search, lists). A price or stock change shows within
 * 5 minutes; the website pages keep reading it fresh.
 */
export const loadStorefrontProductsCached = unstable_cache(() => loadStorefrontProducts(), ["shop:storefront-products"], {
    revalidate: 300,
});

export type StorefrontCategory = { name: string; count: number; fallbackImageUrl: string | null };

/** Categories that have something to show, biggest first, each with a picture
 *  from its first product for when the category has none of its own. */
export function storefrontCategories(products: ShopProductPublic[]): StorefrontCategory[] {
    const byName = new Map<string, ShopProductPublic[]>();
    for (const p of products) byName.set(p.category, [...(byName.get(p.category) ?? []), p]);
    return [...byName]
        .map(([name, inCat]) => ({
            name,
            count: inCat.length,
            fallbackImageUrl: inCat[0]?.galleryUrls[0] ?? inCat[0]?.imageUrl ?? null,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** "Top picks": badged products first, then the rest. */
export function pickFeatured(products: ShopProductPublic[], n = 8): ShopProductPublic[] {
    return [...products]
        .filter((p) => p.badge)
        .concat(products.filter((p) => !p.badge))
        .slice(0, n);
}

function discountPctOf(p: ShopProductPublic): number {
    if (!p.mrpPaise || p.mrpPaise <= p.pricePaise) return 0;
    return (p.mrpPaise - p.pricePaise) / p.mrpPaise;
}

/** "Today's deals": the deepest discounts first. */
export function pickDeals(products: ShopProductPublic[], n = 8): ShopProductPublic[] {
    return [...products]
        .filter((p) => discountPctOf(p) > 0)
        .sort((a, b) => discountPctOf(b) - discountPctOf(a))
        .slice(0, n);
}

export function pickDealOfTheDay(products: ShopProductPublic[]): ShopProductPublic | null {
    const sorted = [...products].sort((a, b) => discountPctOf(b) - discountPctOf(a));
    return sorted[0] ?? null;
}
