import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { recomputeProductStock } from "@/modules/inventory/lib/stockMovement";

/**
 * Products whose saved stock total (InvProduct.stock or a branch row) no longer
 * matches openingStock + Σ(inQty − outQty). Read-only, three aggregate reads
 * whatever the catalogue size. Same formula as recomputeProductStock and
 * src/scripts/recompute-caches.ts.
 *
 * Why it exists: the total is a cache kept by increments, and twice a movement
 * reached the ledger without reaching the cache — the Vyapar import of
 * 2026-09-11 (46 products) and counter pushes whose cloud re-sum failed (41).
 * Nothing compared the two, so a shop product sat Pending for weeks.
 */
export async function findStockDrift(): Promise<number[]> {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
        WITH led AS (
            SELECT "productId", SUM("inQty" - "outQty") AS q
              FROM "InvStockLedger" GROUP BY "productId"
        )
        SELECT p."id"
          FROM "InvProduct" AS p LEFT JOIN led ON led."productId" = p."id"
         WHERE (p."openingStock" IS NOT NULL OR led.q IS NOT NULL)
           AND p."stock" IS DISTINCT FROM ROUND(COALESCE(p."openingStock", 0) + COALESCE(led.q, 0))::int
        UNION
        SELECT b."productId"
          FROM "inv_product_branches" AS b
          LEFT JOIN (
                SELECT "productId", "branchId", SUM("inQty" - "outQty") AS q
                  FROM "InvStockLedger" GROUP BY "productId", "branchId"
               ) AS l ON l."productId" = b."productId" AND l."branchId" = b."branchId"
         WHERE b."stock" <> ROUND(COALESCE(l.q, 0))::int
    `;
    return rows.map((r) => Number(r.id));
}

/** Find drifted products and rewrite their totals from the ledger. Returns the ids fixed. */
export async function repairStockDrift(): Promise<number[]> {
    const ids = await findStockDrift();
    if (ids.length === 0) return ids;
    await prisma.$transaction((tx) => recomputeProductStock(tx, ids), { timeout: 60_000 });
    return ids;
}
