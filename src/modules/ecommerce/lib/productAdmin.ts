import type { InvProduct } from "@/generated/prisma/client";
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
    /** Parcel dimensions of one unit (cm) — drive volumetric weight. */
    lengthCm: number | null;
    breadthCm: number | null;
    heightCm: number | null;
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
    /** Every scannable code on the product (barcode + EAN + UPC) — search only. */
    codes: { kind: string; value: string }[];
};

export function invProductToAdmin(
    p: InvProduct & {
        category?: { name: string } | null;
        brand?: { name: string } | null;
        group?: { name: string } | null;
        codes?: { kind: string; value: string }[];
    },
    bands?: BarcodeBand[]
): ShopProductAdmin {
    // No bands → editable `pricePaise` keeps the effective price (round-trip safe).
    const pub = invProductToPublic(p);
    return {
        ...pub,
        // Mirror the storefront rule (shopCategory ?? group ?? "Accessories") so the
        // admin Category column reads the same as the live shop. The admin row has
        // only the product's DIRECT group, not the root — close enough here, and the
        // separate Group filter already exposes the real group. Storefront truth
        // lives in invProductToPublic + loadShopGroupRoots.
        category: p.shopCategory ?? p.group?.name ?? "Accessories",
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
        lengthCm: p.lengthCm ?? null,
        breadthCm: p.breadthCm ?? null,
        heightCm: p.heightCm ?? null,
        brandName: p.brand?.name ?? null,
        groupName: p.group?.name ?? null,
        shopCategory: p.shopCategory,
        savedSalePricePaise: p.savedSalePricePaise,
        barcodePricePaise: bands ? barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands) : null,
        codes: p.codes ?? [],
    };
}

/** @deprecated use invProductToAdmin */
export const shopProductToAdmin = invProductToAdmin;
