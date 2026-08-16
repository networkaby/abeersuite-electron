// Shared discount-protection helper — the ProductProtection blacklist.
//
// The Retention → Protection page maintains the blacklist; EVERY discount engine
// reads it through this helper, so a protected product is excluded from coupons,
// spend-tier discounts, and loyalty redemption (POS counter, POS quotes/orders,
// and the online shop) with one source of truth. A product can still be sold at
// its tag/negotiated price — only the AUTOMATIC promotions skip it.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/// The product ids currently on the discount blacklist. One indexed query —
/// callers load it once per request and stamp their line data with it.
export async function loadProtectedProductIds(db: Db): Promise<Set<number>> {
    const rows = await db.productProtection.findMany({ select: { productId: true } });
    return new Set(rows.map((r) => r.productId));
}
