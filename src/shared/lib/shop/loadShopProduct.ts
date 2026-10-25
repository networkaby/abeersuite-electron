import { cache } from "react";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic, SHOP_PUBLIC_INCLUDE, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";

/**
 * One product in its storefront shape — for the shop's product page AND the
 * office's full-page preview, so the two can never quote different prices.
 *
 * Bands and stock policy are passed in for the same reason the store home and
 * /shop pass them: the price a customer sees must be the printed barcode tag,
 * identical on the card, this page, the receipt and the shelf label. Without
 * them the mapper falls back to the effective sale price, and the card and the
 * product page quote two different numbers for the same item.
 *
 * `includeHidden` is the office preview: it drops the customer gates (listed in
 * the shop, visible under the stock policy) so a draft is reachable before it
 * ever goes live, and `liveInShop` then says whether a customer could see it.
 * The shop page never sets it — a product the catalogue hides must not stay
 * reachable (and indexable) on its own URL.
 *
 * `cache()` dedupes the whole thing across generateMetadata and the page body,
 * which both need the product — one render, one set of queries.
 */
export const loadShopProduct = cache(
    async (
        handle: string,
        includeHidden: boolean
    ): Promise<{ product: ShopProductPublic; liveInShop: boolean } | null> => {
        const decoded = decodeURIComponent(handle);
        const [bands, policy, groupIndex] = await Promise.all([
            loadBarcodeBands(),
            loadShopStockPolicy(),
            loadShopGroupIndex(),
        ]);

        const listedGate = includeHidden ? {} : { isListedInShop: true };
        const where = /^\d+$/.test(decoded)
            ? { id: parseInt(decoded, 10), ...listedGate, isActive: true }
            : { slug: decoded, ...listedGate, isActive: true };

        const p = await prisma.invProduct.findFirst({
            where,
            include: SHOP_PUBLIC_INCLUDE,
        });
        if (!p) return null;

        const avail = resolveAvailability(p.stock, p.allowBackorder, policy, p.reserved);
        const liveInShop = p.isListedInShop && avail.visible;
        if (!liveInShop && !includeHidden) return null;

        return { product: invProductToPublic(p, { bands, avail, groupIndex }), liveInShop };
    }
);
