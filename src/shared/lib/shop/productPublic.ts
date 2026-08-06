import type { InvProductFull } from "@/shared/types/inventoryTypes";
import { barcodeTagPaise, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";
// From groupTree, NOT groupCategory: this module is reached from client
// components, and groupCategory imports prisma. See groupTree.ts.
import { rootOf, type ShopGroupIndex } from "@/shared/lib/shop/groupTree";
import type { StockStatus } from "@/modules/ecommerce/lib/shopStock";

/** Serializable storefront shape (SSR → client, APIs). */
export type ShopProductPublic = {
    id: number;
    slug: string | null;
    name: string;
    subheading: string | null;
    description: string | null;
    /**
     * Customer-facing category — the product's **OWN** office Group ("Mouse",
     * "HD Dome"), NOT its root and NOT office Category. Drives the chips, shop
     * filter, breadcrumb and JSON-LD. See groupCategory.ts.
     */
    category: string;
    /**
     * The department the category sits under — the ROOT of the group chain
     * ("IT Products"). Used for top-level grouping and the breadcrumb, so the
     * listing page can still show departments without the category itself being
     * flattened to one.
     */
    department: string | null;
    /** Ancestors nearest-first, for breadcrumbs: ["IT Products"] for Mouse. */
    categoryPath: string[];
    /**
     * Customer-facing collection — the office **Category** (marketing bucket:
     * "Office Supplies", "Luxury Items"). A secondary merchandising axis; it
     * deliberately does not compete with `category` for navigation.
     */
    collection: string | null;
    /**
     * The product's office Group id — the taxonomy key the storefront navigates
     * by. Carried so callers can resolve siblings ("similar products") and the
     * breadcrumb chain without re-querying the product.
     */
    groupId: number | null;
    pricePaise: number;
    mrpPaise: number | null;
    badge: string | null;
    imageUrl: string | null;
    galleryUrls: string[];
    specs: Record<string, string>;
    /** Stock display state — drives the out-of-stock notice / backorder label. */
    stockStatus: StockStatus;
    /** Whether the customer may add this to cart / order it. */
    orderable: boolean;
};

export function productPath(p: Pick<ShopProductPublic, "id" | "slug">): string {
    return `/shop/product/${p.slug ?? p.id}`;
}

/** Optional reference data the mapper resolves against. */
export type ShopProductPublicOptions = {
    /** Org barcode bands — see `pricePaise` note below. */
    bands?: BarcodeBand[];
    /** Resolved stock display state. */
    avail?: { status: StockStatus; orderable: boolean };
    /** groupId → group + ancestors, from `loadShopGroupIndex()`. */
    groupIndex?: ShopGroupIndex;
};

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
    opts: ShopProductPublicOptions = {}
): ShopProductPublic {
    const { bands, avail, groupIndex } = opts;
    const group = p.groupId != null ? groupIndex?.get(p.groupId) : undefined;
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
        // Storefront category = the product's OWN group, with shopCategory as the
        // per-product hand-override. Office Category is deliberately NOT in this
        // chain — it is an office-only classification and surfaces as `collection`.
        category: p.shopCategory ?? group?.name ?? "Accessories",
        department: group ? rootOf(group).name : null,
        categoryPath: group?.ancestors.map((a) => a.name) ?? [],
        collection: p.category?.name ?? null,
        groupId: p.groupId,
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
        // Availability defaults to in-stock/orderable for callers that don't
        // resolve it (e.g. the admin shape); storefront APIs pass the resolved value.
        stockStatus: avail?.status ?? "in_stock",
        orderable: avail?.orderable ?? true,
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
