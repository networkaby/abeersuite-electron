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
/** Best sellers rank sales over this many days. */
const BEST_SELLER_DAYS = 30;
/** Buy again looks this far back in the customer's own bills. */
const BUY_AGAIN_DAYS = 730;

/**
 * What real bills say about products — every signal read from posted sale
 * lines, cached so a page view costs no database read:
 *   - bought together (per product, daily)
 *   - best sellers (whole shop, 6 hours)
 *   - buy again (one customer's own bills, 10 minutes)
 */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const postedSale = (since: Date) => ({ status: "POSTED" as const, type: { in: SALE_TYPES }, date: { gte: since } });

/**
 * Product ids most often on the same posted sale bill as `productId`, best
 * first. Read from the DB at most once a day per product (cached), so a
 * product page costs nothing extra on most visits.
 */
const loadBoughtTogetherIds = unstable_cache(
    async (productId: number): Promise<number[]> => {
        const bills = await prisma.voucherInventoryLine.findMany({
            where: { productId, universalVoucher: postedSale(daysAgo(LOOKBACK_DAYS)) },
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

/** Product ids by quantity sold in the last BEST_SELLER_DAYS, best first. */
const loadBestSellerIds = unstable_cache(
    async (): Promise<number[]> => {
        const rows = await prisma.voucherInventoryLine.groupBy({
            by: ["productId"],
            where: { universalVoucher: postedSale(daysAgo(BEST_SELLER_DAYS)) },
            _sum: { quantity: true },
            orderBy: { _sum: { quantity: "desc" } },
            take: 60,
        });
        return rows.map((r) => r.productId);
    },
    ["shop:best-sellers"],
    { revalidate: 6 * 3600 }
);

export async function loadBestSellers(catalogue: ShopProductPublic[], limit = 8): Promise<ShopProductPublic[]> {
    const byId = new Map(catalogue.map((p) => [p.id, p]));
    return (await loadBestSellerIds()).flatMap((id) => byId.get(id) ?? []).slice(0, limit);
}

/**
 * Products on the customer's own bills (any of their accounts — personal and
 * every linked company), most recently bought first.
 */
const loadBuyAgainIds = unstable_cache(
    async (accountIds: number[]): Promise<number[]> => {
        const lines = await prisma.voucherInventoryLine.findMany({
            where: { universalVoucher: { ...postedSale(daysAgo(BUY_AGAIN_DAYS)), partyAccountId: { in: accountIds } } },
            select: { productId: true },
            orderBy: { id: "desc" },
            take: 300,
        });
        return [...new Set(lines.map((l) => l.productId))];
    },
    ["shop:buy-again"],
    { revalidate: 600 }
);

export async function loadBuyAgain(accountIds: number[], catalogue: ShopProductPublic[], limit = 12): Promise<ShopProductPublic[]> {
    if (accountIds.length === 0) return [];
    const byId = new Map(catalogue.map((p) => [p.id, p]));
    return (await loadBuyAgainIds([...accountIds].sort((a, b) => a - b))).flatMap((id) => byId.get(id) ?? []).slice(0, limit);
}
