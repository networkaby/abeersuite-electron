import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic, SHOP_PUBLIC_INCLUDE, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";
import { sharedCollections } from "@/shared/lib/shop/productRelations";
import { ancestorIds, childrenMap, subtreeIds } from "@/shared/lib/tree";

/**
 * "Similar products" — substitutes for the item being viewed.
 *
 * Similarity is the product's **office Group**, and deliberately the EXACT
 * group, not its root. Root-matching would put every mouse, keyboard, cabinet
 * and monitor on one page together (they all root at "IT Products"), which is a
 * department, not a similarity. A shopper looking at a mouse wants other mice.
 *
 * Thin leaves are handled by **widening up the ancestor chain**, one rung at a
 * time, until the row is full: exact group → parent's whole subtree → its
 * parent's, and so on. So a group holding two items still fills its row, but
 * with its nearest neighbours rather than a department-wide dump.
 *
 * Within each rung, items sharing more **collections** with the product come
 * first — a gaming keyboard shows gaming keyboards before plain ones, without
 * a separate subgroup. Collections as a bridge to OTHER groups (cross-sell)
 * live in productRelations.ts.
 *
 * This is NOT cross-sell. A printer's ink is a *different* group and can never
 * be reached from here — that is the separate, hand-curated "related products"
 * axis. See PROJECT_BRAIN.
 */

/** How many "More like this" cards a product page shows. */
export const SIMILAR_PRODUCTS_LIMIT = 12;

/** Every group's id + parent, read once per request — both walks below use it. */
async function loadGroupLinks() {
    return prisma.invProductGroup.findMany({ select: { id: true, parentId: true } });
}

export async function loadSimilarProducts(
    product: { id: number; groupId: number | null; collections?: string[] },
    limit = SIMILAR_PRODUCTS_LIMIT
): Promise<ShopProductPublic[]> {
    if (product.groupId == null) return [];

    const [bands, policy, groupIndex] = await Promise.all([
        loadBarcodeBands(),
        loadShopStockPolicy(),
        loadShopGroupIndex(),
    ]);

    const picked: ShopProductPublic[] = [];
    const takenIds = new Set<number>([product.id]);

    // Widen one rung at a time: the exact group first, then each ancestor's
    // whole subtree. Stop as soon as the row is full.
    // One read of the group links (was one per ancestor).
    const links = await loadGroupLinks();
    const parentOf = new Map(links.map((g) => [g.id, g.parentId]));
    const kids = childrenMap(links);
    const rungs: number[][] = [[product.groupId]];
    for (const a of ancestorIds(product.groupId, (id) => parentOf.get(id))) rungs.push(subtreeIds(kids, a));

    for (const groupIds of rungs) {
        if (picked.length >= limit) break;
        const rows = await prisma.invProduct.findMany({
            where: {
                isListedInShop: true,
                isActive: true,
                groupId: { in: groupIds },
                id: { notIn: [...takenIds] },
            },
            include: SHOP_PUBLIC_INCLUDE,
            // Over-fetch: rows are dropped by the availability gate below and
            // re-ranked by shared collections, so the rung is read wider than
            // the row (a leaf group holds tens, not thousands).
            take: Math.max(limit * 3, 120),
            orderBy: { id: "asc" },
        });

        const mine = new Set(product.collections ?? []);
        const rung = [];
        for (const p of rows) {
            const avail = resolveAvailability(p.stock, p.allowBackorder, policy, p.reserved);
            if (!avail.visible) continue;
            rung.push(invProductToPublic(p, { bands, avail, groupIndex }));
        }
        // Stable: equal scores keep the id order the rail always had.
        if (mine.size > 0) rung.sort((a, b) => sharedCollections(b, mine) - sharedCollections(a, mine));
        for (const p of rung) {
            if (picked.length >= limit) break;
            takenIds.add(p.id);
            picked.push(p);
        }
    }

    return picked;
}
