import { prisma } from "@/shared/lib/prisma/prismaClient";
import { normalizeStockPolicy, type ShopOutOfStockPolicy } from "@/modules/ecommerce/lib/shopStock";

/**
 * Load the org's out-of-stock policy (OrgDefaults.shopOutOfStockPolicy), falling
 * back to NOTIFY when unset. Shared by the storefront product APIs/SSR and the
 * COD order intake. Server-only.
 */
export async function loadShopStockPolicy(): Promise<ShopOutOfStockPolicy> {
    const od = await prisma.orgDefaults.findUnique({
        where: { id: 1 },
        select: { shopOutOfStockPolicy: true },
    });
    return normalizeStockPolicy(od?.shopOutOfStockPolicy);
}
