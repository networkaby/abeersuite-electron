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

/** A tile smaller than this is folded into its parent or a sibling bundle. */
const TILE_MIN_ITEMS = 6;

export type StorefrontCategoryTile = StorefrontCategory & {
    /** Opens /shop with every category in the tile ticked. */
    href: string;
};

/** "A · B · C", or "A · B + 3 more" — "·" because group names carry "&" and ",". */
function tileName(names: string[]): string {
    if (names.length <= 3) return names.join(" · ");
    return `${names.slice(0, 2).join(" · ")} + ${names.length - 2} more`;
}

/**
 * Home-page category tiles without a wall of "1 item" cards. Per parent group:
 * up to two child groups → one tile for the parent; otherwise every child with
 * TILE_MIN_ITEMS or more keeps its own tile and the small ones are packed into
 * sibling bundles ("Mouse Pad · Webcam") of at least that size, so a parent with
 * many tiny children becomes a few tiles, not one giant one. Leftovers too small
 * for a bundle go into the last bundle, or ride along with the smallest big sibling.
 * A tile that ends up holding every child takes the parent's own name.
 */
export function storefrontCategoryTiles(products: ShopProductPublic[]): StorefrontCategoryTile[] {
    const byCat = new Map<string, ShopProductPublic[]>();
    const parentOf = new Map<string, string>();
    for (const p of products) {
        if (!p.category) continue;
        byCat.set(p.category, [...(byCat.get(p.category) ?? []), p]);
        if (!parentOf.has(p.category)) parentOf.set(p.category, p.categoryPath[0] ?? p.category);
    }
    const families = new Map<string, string[]>();
    for (const [cat, parent] of parentOf) families.set(parent, [...(families.get(parent) ?? []), cat]);

    const tiles: StorefrontCategoryTile[] = [];
    const push = (name: string, cats: string[]) => {
        const items = cats.flatMap((c) => byCat.get(c) ?? []);
        const pic = items.find((p) => p.galleryUrls[0] || p.imageUrl);
        tiles.push({
            name,
            count: items.length,
            fallbackImageUrl: pic ? (pic.galleryUrls[0] ?? pic.imageUrl) : null,
            href: `/shop?${cats.map((c) => `category=${encodeURIComponent(c)}`).join("&")}`,
        });
    };
    const size = (c: string) => byCat.get(c)?.length ?? 0;

    for (const [parent, cats] of families) {
        if (cats.length <= 2) {
            push(cats.length === 1 ? cats[0] : parent, cats);
            continue;
        }
        // A tile holding every child IS the parent: show its real name, not "A · B · C".
        const label = (b: string[]) => (b.length === cats.length ? parent : tileName(b));
        const big = cats.filter((c) => size(c) >= TILE_MIN_ITEMS);
        const small = cats.filter((c) => size(c) < TILE_MIN_ITEMS).sort((a, b) => size(b) - size(a));
        const smallTotal = small.reduce((n, c) => n + size(c), 0);
        // Too few for a tile of their own: ride along with the smallest big sibling.
        const host = smallTotal < TILE_MIN_ITEMS && big.length ? [...big].sort((x, y) => size(x) - size(y))[0] : null;
        for (const c of big) push(c === host ? label([c, ...small]) : c, c === host ? [c, ...small] : [c]);
        if (small.length === 0 || host) continue;
        if (smallTotal < TILE_MIN_ITEMS) {
            push(parent, small);
            continue;
        }
        const bundles: string[][] = [];
        let cur: string[] = [];
        let n = 0;
        for (const c of small) {
            cur.push(c);
            n += size(c);
            if (n >= TILE_MIN_ITEMS) {
                bundles.push(cur);
                cur = [];
                n = 0;
            }
        }
        if (cur.length) {
            if (bundles.length) bundles[bundles.length - 1].push(...cur);
            else bundles.push(cur);
        }
        for (const b of bundles) push(label(b), b);
    }
    return tiles.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
