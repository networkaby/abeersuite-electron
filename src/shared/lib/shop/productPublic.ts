import type { InvProductFull } from "@/shared/types/inventoryTypes";
import { barcodeTagPaise, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";

/** Serializable storefront shape (SSR → client, APIs). */
export type ShopProductPublic = {
    id: number;
    slug: string | null;
    name: string;
    subheading: string | null;
    description: string | null;
    category: string;
    pricePaise: number;
    mrpPaise: number | null;
    badge: string | null;
    imageUrl: string | null;
    galleryUrls: string[];
    specs: Record<string, string>;
};

export function productPath(p: Pick<ShopProductPublic, "id" | "slug">): string {
    return `/shop/product/${p.slug ?? p.id}`;
}

/**
 * Map an InvProduct to its storefront shape.
 *
 * When `bands` is supplied (the org's barcode bands), the displayed `pricePaise`
 * is the **printed barcode tag price** derived from the saved sale price + MRP —
 * so the shop price equals the shelf label and the POS receipt. It falls back to
 * `effectiveSalePricePaise` when the product has no saved sale price. When
 * `bands` is omitted the legacy behaviour (effectiveSalePricePaise) is kept, so
 * existing non-storefront callers are unaffected.
 */
export function invProductToPublic(
    p: InvProductFull & { category?: { name: string } | null },
    bands?: BarcodeBand[]
): ShopProductPublic {
    const rawGal = p.galleryJson;
    let galleryUrls: string[] = [];
    if (Array.isArray(rawGal)) {
        galleryUrls = rawGal.filter((x): x is string => typeof x === "string");
    }
    if (galleryUrls.length === 0 && p.imageUrl) galleryUrls = [p.imageUrl];

    const rawSpecs = p.specsJson;
    const specs: Record<string, string> = {};
    if (rawSpecs && typeof rawSpecs === "object" && !Array.isArray(rawSpecs)) {
        for (const [k, v] of Object.entries(rawSpecs as Record<string, unknown>)) {
            if (typeof v === "string") specs[k] = v;
        }
    }

    return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        subheading: p.shopSubheading,
        description: p.shopDescription,
        category: p.shopCategory ?? p.category?.name ?? "Accessories",
        // Shop price = printed barcode tag (shelf == shop == receipt) when bands are
        // supplied, else the materialized effectiveSalePricePaise. Exposed under the
        // stable shop field name `pricePaise` so the storefront UI is unchanged.
        pricePaise:
            (bands ? barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands) : null) ??
            p.effectiveSalePricePaise ??
            0,
        mrpPaise: p.mrpPaise,
        badge: p.shopBadge,
        imageUrl: p.imageUrl,
        galleryUrls,
        specs,
    };
}

/** @deprecated use invProductToPublic */
export const shopProductToPublic = invProductToPublic;

/** Deterministic demo star rating (4.2–4.9) and review count for UI polish. */
export function demoRating(productId: number): { stars: number; reviewCount: number } {
    const reviewCount = 18 + (productId % 210);
    const stars = 4.2 + (productId % 8) / 10;
    return { stars: Math.round(stars * 10) / 10, reviewCount };
}
