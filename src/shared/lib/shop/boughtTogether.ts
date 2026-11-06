import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";

/** How far back bills are read for "Frequently bought together". */
const LOOKBACK_DAYS = 365;
/** Most bills sampled per product — enough to rank, cheap to read. */
const BILL_SAMPLE = 400;
/** A pairing seen on fewer bills than this is chance, not a habit. */
const MIN_SHARED_BILLS = 2;
const SALE_TYPES = ["POS", "SALE", "ONLINE_INVOICE"];

/**
 * Product ids most often on the same posted sale bill as `productId`, best
 * first. Read from the DB at most once a day per product (cached), so a
 * product page costs nothing extra on most visits.
 */
const loadBoughtTogetherIds = unstable_cache(
    async (productId: number): Promise<number[]> => {
        const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
        const bills = await prisma.voucherInventoryLine.findMany({
            where: {
                productId,
                universalVoucher: { status: "POSTED", type: { in: SALE_TYPES }, date: { gte: since } },
            },
            select: { universalVoucherId: true },
            orderBy: { id: "desc" },
            take: BILL_SAMPLE,
        });
        const billIds = [...new Set(bills.map((b) => b.universalVoucherId))];
        if (billIds.length === 0) return [];
        const pairs = await prisma.voucherInventoryLine.groupBy({
            by: ["productId"],
            where: { universalVoucherId: { in: billIds }, productId: { not: productId } },
            _count: { universalVoucherId: true },
        });
        return pairs
            .filter((p) => p._count.universalVoucherId >= MIN_SHARED_BILLS)
            .sort((a, b) => b._count.universalVoucherId - a._count.universalVoucherId)
            .map((p) => p.productId);
    },
    ["shop:bought-together"],
    { revalidate: 86_400 }
);

/** The bought-together ids resolved against the visible catalogue (hidden / unlisted drop out). */
export async function loadBoughtTogether(
    productId: number,
    catalogue: ShopProductPublic[],
    limit = 8
): Promise<ShopProductPublic[]> {
    const ids = await loadBoughtTogetherIds(productId);
    const byId = new Map(catalogue.map((p) => [p.id, p]));
    return ids.flatMap((id) => byId.get(id) ?? []).slice(0, limit);
}
