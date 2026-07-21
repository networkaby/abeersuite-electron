import type { InvProductFull } from "@/shared/types/inventoryTypes";
import { invProductToPublic, type ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { barcodeTagPaise, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";

/** Admin shape — storefront fields + inventory + stock management. */
export type ShopProductAdmin = ShopProductPublic & {
    sku: string;
    stock: number | null;
    lowStockThreshold: number;
    isActive: boolean;
    isListedInShop: boolean;
    /** Per-product override: accept orders even at zero stock (backorder). */
    allowBackorder: boolean;
    unitId: number;
    categoryId: number | null;
    groupId: number | null;
    brandId: number | null;
    warrantyTermId: number | null;
    /** Shipping weight of one unit in grams (null = unset → quote uses fallback). */
    weightGrams: number | null;
    /** Resolved brand / product-group display names (null when unset). */
    brandName: string | null;
    groupName: string | null;
    /** Raw explicit storefront category (null when unset) — for the publish gate. */
    shopCategory: string | null;
    // Display-only: the human saved sale price and the derived barcode tag price
    // (what the storefront actually charges). The editable `pricePaise` above
    // stays the effective/strategy price so the form round-trips it unchanged.
    savedSalePricePaise: number | null;
    barcodePricePaise: number | null;
};

export function invProductToAdmin(
    p: InvProductFull & {
        category?: { name: string } | null;
        brand?: { name: string } | null;
        group?: { name: string } | null;
    },
    bands?: BarcodeBand[]
): ShopProductAdmin {
    // No bands → editable `pricePaise` keeps the effective price (round-trip safe).
    const pub = invProductToPublic(p);
    return {
        ...pub,
        sku: p.sku,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold,
        isActive: p.isActive,
        isListedInShop: p.isListedInShop,
        allowBackorder: p.allowBackorder,
        unitId: p.unitId,
        categoryId: p.categoryId,
        groupId: p.groupId,
        brandId: p.brandId,
        warrantyTermId: p.warrantyTermId,
        weightGrams: p.weightGrams ?? null,
        brandName: p.brand?.name ?? null,
        groupName: p.group?.name ?? null,
        shopCategory: p.shopCategory,
        savedSalePricePaise: p.savedSalePricePaise,
        barcodePricePaise: bands ? barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands) : null,
    };
}

/** @deprecated use invProductToAdmin */
export const shopProductToAdmin = invProductToAdmin;
