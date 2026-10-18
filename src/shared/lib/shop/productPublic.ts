import type { InvProduct } from "@/generated/prisma/client";
import { barcodeTagPaise, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";
// From groupTree, NOT groupCategory: this module is reached from client
// components, and groupCategory imports prisma. See groupTree.ts.
import { rootOf, type ShopGroupIndex } from "@/shared/lib/shop/groupTree";
import type { StockStatus } from "@/modules/ecommerce/lib/shopStock";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/** Serializable storefront shape (SSR → client, APIs). */
export type ShopProductPublic = {
    id: number;
    slug: string | null;
    /** Internal/offline name (InvProduct.name) — inventory, POS, admin lists. */
    name: string;
    /** Manual online display name (InvProduct.shopSubheading). Customer-facing
     *  surfaces should show `displayName`, not this — it's only kept for the
     *  admin form to edit. */
    subheading: string | null;
    /** What customers actually see as the product title: subheading if the
     *  operator set one, else the offline name. Single source for every
     *  customer-facing heading — never show `name` and `subheading` as two lines. */
    displayName: string;
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

/**
 * The staff full-page preview of a product, whatever its publish state — a
 * draft looks exactly as it will once live. Not under /shop because the desktop
 * app is built without the shop pages and runs on its own sign-in: a /shop link
 * there is a 404, and many staff may not sign in from an outside browser at all
 * ("Can login outside counter"). See `src/app/preview/product/[id]/page.tsx`.
 */
export function productPreviewPath(p: Pick<ShopProductPublic, "id">): string {
    return `/preview/product/${p.id}`;
}

/**
 * The product's page on the real shop website — the "Open in shop" link, for a
 * published product only. Absolute on purpose: the desktop app sends an outside
 * address to the computer's own browser.
 */
export function productShopUrl(p: Pick<ShopProductPublic, "id" | "slug">): string {
    return `${COMPANY_DETAILS.sites.shop}${productPath(p)}`;
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

/** A product's photos, main one first: `galleryJson`, or the lone `imageUrl` when an
 *  older row has no gallery. The storefront and the phone Photos screen both read it. */
export function productGalleryUrls(galleryJson: unknown, imageUrl: string | null): string[] {
    const urls = Array.isArray(galleryJson)
        ? galleryJson.filter((x): x is string => typeof x === "string")
        : [];
    return urls.length === 0 && imageUrl ? [imageUrl] : urls;
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
    p: InvProduct & { category?: { name: string } | null },
    opts: ShopProductPublicOptions = {}
): ShopProductPublic {
    const { bands, avail, groupIndex } = opts;
    const group = p.groupId != null ? groupIndex?.get(p.groupId) : undefined;
    const galleryUrls = productGalleryUrls(p.galleryJson, p.imageUrl);

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
        displayName: p.shopSubheading?.trim() || p.name,
        description: p.shopDescription,
        // Storefront category = the product's OWN group, with shopCategory as the
        // per-product hand-override. Office Category is deliberately NOT in this
        // chain — it is the second, cross-cutting axis and surfaces as `collection`.
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

