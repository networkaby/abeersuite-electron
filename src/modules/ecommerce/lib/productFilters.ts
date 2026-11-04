// Product list filters — one definition shared by E-Commerce → Products and the
// AI descriptions screen, so a new filter (photos, description, …) lands on both.
// Pure / framework-free: runs over the already-loaded admin list, no extra query.

import type { ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { shopQualification, type ShopPublishRules } from "@/modules/ecommerce/lib/shopQualification";

export type StockFilter = "all" | "in" | "out" | "untracked";
export type ActiveFilter = "all" | "active" | "inactive";
export type StatusFilter = "all" | "live" | "ready" | "needs";
export type PhotoFilter = "all" | "none" | "one" | "has" | "2" | "3" | "5"; // "has" = 1 or more (kept for saved filters)
export type DescriptionFilter = "all" | "has" | "missing";

export type ProductFilters = {
    query: string;
    category: string;
    brand: string;
    group: string;
    stock: StockFilter;
    status: StatusFilter;
    active: ActiveFilter;
    photos: PhotoFilter;
    description: DescriptionFilter;
};

export const EMPTY_PRODUCT_FILTERS: ProductFilters = {
    query: "",
    category: "all",
    brand: "all",
    group: "all",
    stock: "all",
    status: "all",
    active: "all",
    photos: "all",
    description: "all",
};

export type ProductStatus = { kind: "live" | "ready" | "draft"; missing: string[] };

/** Per-row shop status, reusing the same qualification gate the server enforces. */
export function productStatus(p: ShopProductAdmin, rules: ShopPublishRules): ProductStatus {
    const q = shopQualification(
        {
            pricePaise: p.barcodePricePaise ?? p.pricePaise,
            imageUrl: p.imageUrl,
            galleryUrls: p.galleryUrls,
            description: p.description,
            category: p.shopCategory,
            groupId: p.groupId,
            brandId: p.brandId,
            mrpPaise: p.mrpPaise,
            stock: p.stock,
            allowBackorder: p.allowBackorder,
            weightGrams: p.weightGrams,
        },
        rules
    );
    if (p.isListedInShop && q.qualified) return { kind: "live", missing: [] };
    return { kind: q.qualified ? "ready" : "draft", missing: q.missing };
}

/** Gallery photos, or 1 when only the main image is set — the same rule the shop-ready check uses. */
export const productPhotoCount = (p: ShopProductAdmin) => p.galleryUrls.length || (p.imageUrl ? 1 : 0);
export const hasDescription = (p: ShopProductAdmin) => !!p.description?.trim();

/** Filters moved off the screen's defaults, minus the search box (the Filters badge). */
export function activeFilterCount(f: ProductFilters, defaults: ProductFilters = EMPTY_PRODUCT_FILTERS): number {
    return (Object.keys(f) as (keyof ProductFilters)[])
        .filter((k) => k !== "query" && f[k] !== defaults[k]).length;
}

export function matchesProductFilters(p: ShopProductAdmin, f: ProductFilters, rules: ShopPublishRules): boolean {
    if (f.category !== "all" && p.category !== f.category) return false;
    if (f.brand !== "all" && p.brandName !== f.brand) return false;
    if (f.group !== "all" && p.groupName !== f.group) return false;
    if (f.stock === "untracked" && p.stock !== null) return false;
    if (f.stock === "in" && !(p.stock !== null && p.stock > 0)) return false;
    if (f.stock === "out" && p.stock !== 0) return false;
    if (f.active === "active" && !p.isActive) return false;
    if (f.active === "inactive" && p.isActive) return false;
    if (f.photos !== "all") {
        const n = productPhotoCount(p);
        if (f.photos === "none" ? n !== 0 : f.photos === "one" ? n !== 1 : n < (f.photos === "has" ? 1 : Number(f.photos))) return false;
    }
    if (f.description === "has" && !hasDescription(p)) return false;
    if (f.description === "missing" && hasDescription(p)) return false;
    if (f.status !== "all") {
        const k = productStatus(p, rules).kind;
        if (f.status === "needs" ? k !== "draft" : k !== f.status) return false;
    }
    const q = f.query.trim().toLowerCase();
    if (q && !`${p.name} ${p.sku} ${p.category} ${p.brandName ?? ""} ${p.groupName ?? ""} ${(p.codes ?? []).map((c) => c.value).join(" ")}`.toLowerCase().includes(q))
        return false;
    return true;
}

/** Sorted distinct values for the Category / Brand / Group dropdowns. */
export function productFilterOptions(products: ShopProductAdmin[]) {
    const distinct = (pick: (p: ShopProductAdmin) => string | null) =>
        [...new Set(products.map(pick).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
    return {
        categories: distinct((p) => p.category),
        brands: distinct((p) => p.brandName),
        groups: distinct((p) => p.groupName),
    };
}
