import { productPath, type ShopProductPublic } from "@/shared/lib/shop/productPublic";

/**
 * The option buttons on a product page (owner, 2026-11-10 — like Amazon /
 * Flipkart): every product the customer can see that shares this one's variant
 * family, this one included and marked. Built from the cached storefront
 * catalogue, so a page reads nothing extra from the database; a hidden or
 * unpublished sibling is simply not in the catalogue. Fewer than two → none.
 */
export type VariantOption = { id: number; label: string; href: string; current: boolean; available: boolean };

export function buildVariantOptions(
    product: ShopProductPublic,
    catalogue: ShopProductPublic[],
    /** The customer app links to its own product route. */
    pathOf: (p: ShopProductPublic) => string = productPath
): VariantOption[] {
    if (product.variantFamilyId == null) return [];
    const members = catalogue.filter((p) => p.variantFamilyId === product.variantFamilyId);
    if (!members.some((p) => p.id === product.id)) members.push(product);
    if (members.length < 2) return [];
    return members
        .sort((a, b) => a.id - b.id)
        .map((p) => ({
            id: p.id,
            // No label set → the shop title, so a button is never blank.
            label: p.variantLabel?.trim() || p.displayName,
            href: pathOf(p),
            current: p.id === product.id,
            available: p.stockStatus !== "out_of_stock",
        }));
}
