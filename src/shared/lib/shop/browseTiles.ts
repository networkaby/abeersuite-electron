import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";
import { groupSubtreeIds, loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";

/**
 * Browse tiles — every category (office Group), collection (office Category)
 * and brand that has something listed, each linking to its own root page
 * (`/laptops`, `/gaming`, `/hp`). The home page shows a daily handful of each
 * with a "More" link; `/shop?view=…` lists them all.
 *
 * Only rows with a slug become tiles: a tile must open an indexable page,
 * never a `/shop?category=` filter copy.
 */
export type BrowseTile = { name: string; href: string; count: number; imageUrl: string | null };
export type BrowseKind = "categories" | "collections" | "brands";
export type BrowseTiles = Record<BrowseKind, BrowseTile[]>;

const firstImage = (p: { galleryUrls: string[]; imageUrl: string | null }) => p.galleryUrls[0] ?? p.imageUrl ?? null;
const byCount = (a: BrowseTile, b: BrowseTile) => b.count - a.count || a.name.localeCompare(b.name);

async function buildBrowseTiles(): Promise<BrowseTiles> {
    const [products, groupIndex, groups, collections, brands] = await Promise.all([
        loadStorefrontProductsCached(),
        loadShopGroupIndex(),
        prisma.invProductGroup.findMany({
            where: { isActive: true, slug: { not: null } },
            select: { id: true, name: true, slug: true, imageUrl: true },
        }),
        prisma.invCategory.findMany({
            where: { isActive: true, slug: { not: null } },
            select: { name: true, slug: true, imageUrl: true },
        }),
        prisma.invBrand.findMany({
            where: { isActive: true, slug: { not: null } },
            select: {
                name: true,
                slug: true,
                imageUrl: true,
                // Public products carry no brand, so brands count at the DB (listed + active).
                _count: { select: { products: { where: { isListedInShop: true, isActive: true } } } },
            },
        }),
    ]);

    const categories: BrowseTile[] = [];
    for (const g of groups) {
        const ids = new Set(groupSubtreeIds(groupIndex, g.id));
        const items = products.filter((p) => p.groupId != null && ids.has(p.groupId));
        if (items.length === 0) continue;
        const pic = items.find(firstImage);
        categories.push({ name: g.name, href: `/${g.slug}`, count: items.length, imageUrl: g.imageUrl ?? (pic ? firstImage(pic) : null) });
    }

    const collectionTiles: BrowseTile[] = [];
    for (const c of collections) {
        const items = products.filter((p) => p.collections.includes(c.name));
        if (items.length === 0) continue;
        const pic = items.find(firstImage);
        collectionTiles.push({ name: c.name, href: `/${c.slug}`, count: items.length, imageUrl: c.imageUrl ?? (pic ? firstImage(pic) : null) });
    }

    const brandTiles: BrowseTile[] = [];
    for (const b of brands) {
        if (b._count.products === 0) continue;
        brandTiles.push({ name: b.name, href: `/${b.slug}`, count: b._count.products, imageUrl: b.imageUrl });
    }

    return {
        categories: categories.sort(byCount),
        collections: collectionTiles.sort(byCount),
        brands: brandTiles.sort(byCount),
    };
}

/** Same 5-minute freshness as the cached catalogue it is built from. */
export const loadBrowseTiles = unstable_cache(buildBrowseTiles, ["shop:browse-tiles"], { revalidate: 300 });

/** A small deterministic PRNG, so one day's pick is the same for every visitor and for Google. */
function seededRandom(seedText: string): () => number {
    let h = 2166136261;
    for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
    return () => {
        h = Math.imul(h ^ (h >>> 15), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    };
}

/**
 * Today's handful: the `pinned` biggest stay put (the shop's core range), the
 * rest of the row rotates daily. Same answer all day, so the page stays
 * cacheable and Google sees one stable page; every item is still reachable
 * from the full list and the sitemap.
 */
export function dailyPick<T>(items: T[], n: number, todayIso: string, salt: string, pinned = 3): T[] {
    if (items.length <= n) return items;
    const head = items.slice(0, Math.min(pinned, n));
    const rest = items.slice(head.length);
    const rand = seededRandom(`${todayIso}:${salt}`);
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
    return [...head, ...rest.slice(0, n - head.length)];
}
