import { auth } from "@/auth";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { loadShopAds } from "@/shared/lib/shop/loadShopAds";
import type { ShopAdContext } from "@/shared/lib/shop/ads";

/**
 * Everything a server-rendered shop page hands its ad picker: the pool, a
 * per-visit rotation seed (made HERE so the client hydrates with the same
 * one), today's date, and whether `?adPreview=1` may draw placeholders — only
 * for a signed-in staff session, never a customer.
 */
export async function loadShopAdContext(searchParams: { adPreview?: string }): Promise<ShopAdContext> {
    const [ads, session] = await Promise.all([
        loadShopAds(),
        searchParams.adPreview === "1" ? auth() : Promise.resolve(null),
    ]);
    return {
        ads,
        adSeed: Math.floor(Math.random() * 1_000_000),
        adPreview: Boolean(session?.user),
        todayIso: businessTodayIso(),
    };
}
