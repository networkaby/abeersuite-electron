import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";

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
 * This is NOT cross-sell. A printer's ink is a *different* group and can never
 * be reached from here — that is the separate, hand-curated "related products"
 * axis. See PROJECT_BRAIN.
 */

/** How many "More like this" cards a product page shows. */
export const SIMILAR_PRODUCTS_LIMIT = 12;

/** groupId → its ancestor chain, nearest first: [parent, grandparent, …]. */
async function loadAncestors(groupId: number): Promise<number[]> {
    const rows = await prisma.invProductGroup.findMany({ select: { id: true, parentId: true } });
    const parentOf = new Map(rows.map((g) => [g.id, g.parentId]));
    const chain: number[] = [];
    const seen = new Set<number>([groupId]);
    let cur = parentOf.get(groupId) ?? null;
    while (cur != null && !seen.has(cur)) {
        chain.push(cur);
        seen.add(cur);
        cur = parentOf.get(cur) ?? null;
    }
    return chain;
}

/** Every group id in the subtree rooted at `rootId`, including itself. */
async function loadSubtree(rootId: number): Promise<number[]> {
    const rows = await prisma.invProductGroup.findMany({ select: { id: true, parentId: true } });
    const childrenOf = new Map<number, number[]>();
    for (const g of rows) {
        if (g.parentId == null) continue;
        childrenOf.set(g.parentId, [...(childrenOf.get(g.parentId) ?? []), g.id]);
    }
    const out: number[] = [];
    const stack = [rootId];
    const seen = new Set<number>();
    while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        stack.push(...(childrenOf.get(id) ?? []));
    }
    return out;
}

export async function loadSimilarProducts(
    product: { id: number; groupId: number | null },
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
    const ancestors = await loadAncestors(product.groupId);
    const rungs: number[][] = [[product.groupId]];
    for (const a of ancestors) rungs.push(await loadSubtree(a));

    for (const groupIds of rungs) {
        if (picked.length >= limit) break;
        const rows = await prisma.invProduct.findMany({
            where: {
                isListedInShop: true,
                isActive: true,
                groupId: { in: groupIds },
                id: { notIn: [...takenIds] },
            },
            include: { category: { select: { name: true } } },
            // Over-fetch: some rows are dropped by the availability gate below,
            // and a hard `take` of exactly `limit` could return a short row.
            take: limit * 3,
            orderBy: { id: "asc" },
        });

        for (const p of rows) {
            if (picked.length >= limit) break;
            const avail = resolveAvailability(p.stock, p.allowBackorder, policy, p.reserved);
            if (!avail.visible) continue;
            takenIds.add(p.id);
            picked.push(invProductToPublic(p, { bands, avail, groupIndex }));
        }
    }

    return picked;
}
