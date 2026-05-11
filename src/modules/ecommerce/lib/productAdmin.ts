import type { InvProductFull } from "@/shared/types/inventoryTypes";
import { invProductToPublic, type ShopProductPublic } from "@/shared/lib/shop/productPublic";

/** Admin shape — storefront fields + inventory + stock management. */
export type ShopProductAdmin = ShopProductPublic & {
    sku: string;
    stock: number | null;
    lowStockThreshold: number;
    isActive: boolean;
    isListedInShop: boolean;
    unitId: number;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
};

export function invProductToAdmin(
    p: InvProductFull & { category?: { name: string } | null }
): ShopProductAdmin {
    const pub = invProductToPublic(p);
    return {
        ...pub,
        sku: p.sku,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold,
        isActive: p.isActive,
        isListedInShop: p.isListedInShop,
        unitId: p.unitId,
        categoryId: p.categoryId,
        groupId: p.groupId,
        brandId: p.brandId,
        warrantyTermId: p.warrantyTermId,
    };
}

/** @deprecated use invProductToAdmin */
export const shopProductToAdmin = invProductToAdmin;
