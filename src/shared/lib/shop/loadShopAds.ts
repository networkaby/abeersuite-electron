import { prisma } from "@/shared/lib/prisma/prismaClient";
import { normalizeAds, type ShopAd } from "@/shared/lib/shop/ads";

/**
 * Load the org's storefront ad inventory, falling back to the code default
 * (samples, off). Ads are decoration: if the read fails for any reason — the
 * column not migrated yet, a stale client — the shop renders without them
 * rather than going down.
 */
export async function loadShopAds(): Promise<ShopAd[]> {
    try {
        const od = await prisma.orgDefaults.findUnique({
            where: { id: 1 },
            select: { storefrontAdsJson: true },
        });
        return normalizeAds(od?.storefrontAdsJson);
    } catch (e) {
        console.error("[shop-ads] load failed, showing none:", e instanceof Error ? e.message : e);
        return normalizeAds(null);
    }
}
