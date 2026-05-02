import type { ShopProduct } from "@/generated/prisma/client";
import { shopProductToPublic, type ShopProductPublic } from "@/lib/shop/product-public";

/** Admin API / UI shape — storefront fields plus inventory. */
export type ShopProductAdmin = ShopProductPublic & {
    stock: number | null;
    lowStockThreshold: number;
    isActive: boolean;
};

export function shopProductToAdmin(p: ShopProduct): ShopProductAdmin {
    const pub = shopProductToPublic(p);
    return {
        ...pub,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold,
        isActive: p.isActive,
    };
}
