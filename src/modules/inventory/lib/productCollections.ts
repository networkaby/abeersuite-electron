// A product's Collections (InvCategory) — the one write path for the
// `inv_product_collections` list and its mirror, InvProduct.categoryId (the MAIN
// collection, always the list's first). Every product writer that touches either
// goes through here, so the two can never disagree.
//
// Collections are shop / marketing only. Pricing, loyalty, coupons, POS and the
// reports read the single main collection (or Group), so a product in three
// collections is still counted once.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";

type Tx = Prisma.TransactionClient;

/** True when every id is a real collection — checked before a save, so a stale id is a 400, not a FK 500. */
export async function collectionsExist(ids: readonly number[]): Promise<boolean> {
    const list = clean(ids);
    if (list.length === 0) return true;
    return (await prisma.invCategory.count({ where: { id: { in: list } } })) === list.length;
}

/** De-duplicated, order kept — the first id is the main collection. */
function clean(ids: readonly number[]): number[] {
    return [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
}

/** Replace the whole list; the first id becomes the main collection. */
export async function setProductCollections(tx: Tx, productId: number, ids: readonly number[]): Promise<void> {
    const list = clean(ids);
    await tx.invProductCollection.deleteMany({ where: { productId } });
    if (list.length > 0) {
        await tx.invProductCollection.createMany({
            data: list.map((categoryId, sortOrder) => ({ productId, categoryId, sortOrder })),
        });
    }
    await tx.invProduct.update({ where: { id: productId }, data: { categoryId: list[0] ?? null } });
}

/**
 * A writer that only knows the single `categoryId` (inventory grid, import, older
 * clients): make it the main collection and keep the product's other collections.
 * `null` drops the main one and promotes the next.
 */
export async function setMainCollection(tx: Tx, productId: number, categoryId: number | null): Promise<void> {
    const rows = await tx.invProductCollection.findMany({
        where: { productId },
        orderBy: { sortOrder: "asc" },
        select: { categoryId: true },
    });
    const rest = rows.map((r) => r.categoryId);
    const next = categoryId == null ? rest.slice(1) : [categoryId, ...rest.slice(1).filter((id) => id !== categoryId)];
    await setProductCollections(tx, productId, next);
}

/**
 * Bulk writers (product import's createMany) set `categoryId` directly: bring
 * each listed product's collection list in line with it afterwards — the main
 * row follows `categoryId`, extra collections are kept. A product whose
 * categoryId is now null keeps its extras as shop-only collections.
 */
export async function syncMainCollections(tx: Tx, productIds: readonly number[]): Promise<void> {
    const ids = clean(productIds);
    if (ids.length === 0) return;
    // An old main that no longer matches, or the new main sitting as an extra.
    await tx.$executeRaw`
        DELETE FROM "inv_product_collections" c USING "InvProduct" p
        WHERE c."productId" = p."id" AND p."id" = ANY(${ids})
          AND ((c."sortOrder" = 0 AND c."categoryId" IS DISTINCT FROM p."categoryId")
            OR (c."sortOrder" <> 0 AND c."categoryId" = p."categoryId"))`;
    await tx.$executeRaw`
        INSERT INTO "inv_product_collections" ("productId", "categoryId", "sortOrder")
        SELECT "id", "categoryId", 0 FROM "InvProduct"
        WHERE "id" = ANY(${ids}) AND "categoryId" IS NOT NULL
        ON CONFLICT ("productId", "categoryId") DO UPDATE SET "sortOrder" = 0`;
}

/**
 * The body of a product save → which of the two to call, if any. `collectionIds`
 * wins when both are sent (the new multi-pick form sends both on purpose, so an
 * older server still gets the main one).
 */
export async function applyCollections(
    tx: Tx,
    productId: number,
    body: { collectionIds?: number[] | null; categoryId?: number | null },
): Promise<void> {
    if (body.collectionIds !== undefined) return setProductCollections(tx, productId, body.collectionIds ?? []);
    if (body.categoryId !== undefined) return setMainCollection(tx, productId, body.categoryId);
}
