// Product list filters — one definition shared by E-Commerce → Products and the
// AI descriptions screen, so a new filter (photos, description, …) lands on both.
// Pure / framework-free: runs over the already-loaded admin list, no extra query.

import type { ShopProductAdmin } from "@/modules/ecommerce/lib/productAdmin";
import { shopQualification, type ShopPublishRules } from "@/modules/ecommerce/lib/shopQualification";
import { flattenTree, subtreeIds, treeLabel, type TreeNodeRow } from "@/shared/lib/tree";

export type StockFilter = "all" | "in" | "out" | "untracked";
export type ActiveFilter = "all" | "active" | "inactive";
/** Shop stage (owner, 2026-11-07); "pending" = published but a publish rule unmet. */
/** Stage filter — Draft is a stage like the others (owner, 2026-11-10). */
/** "attention" = a Draft parked until a manual check is done (owner, 2026-11-11). */
export type StatusFilter = "all" | "unpublished" | "waiting" | "draft" | "ready" | "live" | "pending" | "attention";
export type PhotoFilter = "all" | "none" | "one" | "has" | "2" | "3" | "5"; // "has" = 1 or more (kept for saved filters)
export type DescriptionFilter = "all" | "has" | "missing";

export type ProductFilters = {
    query: string;
    /** Collection id (InvCategory) or "all" — picking a parent matches its children too. */
    category: string;
    /** Brand id or "all". */
    brand: string;
    /** Product group id or "all" — picking a parent matches its children too. */
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

export type ProductStatus = { kind: Exclude<StatusFilter, "all">; missing: string[] };

/**
 * Per-row shop stage: UNPUBLISHED / DRAFT / READY as staff left it; PUBLISHED is Live
 * when the publish rules are met, else Pending (with what is missing). Reuses
 * the server's gate, so a rule unmet since the last save (stock, price) shows
 * as Pending here at once.
 */
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
            variantAttrGaps: p.variantAttrGaps ?? [],
        },
        rules
    );
    if (p.shopStatus === "ATTENTION") return { kind: "attention", missing: q.missing };
    if (p.shopStatus === "WAITING") return { kind: "waiting", missing: q.missing };
    if (p.shopStatus === "UNPUBLISHED") return { kind: "unpublished", missing: q.missing };
    if (p.shopStatus === "DRAFT") return { kind: "draft", missing: q.missing };
    if (p.shopStatus === "READY") return { kind: "ready", missing: q.missing };
    return p.isListedInShop && q.qualified ? { kind: "live", missing: [] } : { kind: "pending", missing: q.missing };
}

const STAGES: string[] = ["unpublished", "waiting", "draft", "ready", "live", "pending", "attention"] satisfies ProductStatus["kind"][];

/** Gallery photos, or 1 when only the main image is set — the same rule the shop-ready check uses. */
export const productPhotoCount = (p: ShopProductAdmin) => p.galleryUrls.length || (p.imageUrl ? 1 : 0);
export const hasDescription = (p: ShopProductAdmin) => !!p.description?.trim();

/** Filters moved off the screen's defaults, minus the search box (the Filters badge). */
export function activeFilterCount(f: ProductFilters, defaults: ProductFilters = EMPTY_PRODUCT_FILTERS): number {
    return (Object.keys(f) as (keyof ProductFilters)[])
        .filter((k) => k !== "query" && f[k] !== defaults[k]).length;
}

/** The master trees the Collection / Group filters read (cached masters). */
export type ProductFilterTrees = { categories: TreeNodeRow[]; groups: TreeNodeRow[] };

/** Ids a picked node stands for: itself + every child. null = no filter.
 *  A value saved before filters went by id (a name) is ignored. */
function pickedIds(value: string, rows: TreeNodeRow[]): Set<number> | null {
    const id = Number(value);
    if (value === "all" || !Number.isInteger(id)) return null;
    return new Set(subtreeIds(rows, id));
}

/** One matcher per filter change — the subtrees are worked out once, not per row. */
export function productFilterMatcher(f: ProductFilters, rules: ShopPublishRules, trees: ProductFilterTrees) {
    const collections = pickedIds(f.category, trees.categories);
    const groups = pickedIds(f.group, trees.groups);
    const brand = pickedIds(f.brand, []);
    return (p: ShopProductAdmin) => matchesProductFilters(p, f, rules, { collections, groups, brand });
}

function matchesProductFilters(
    p: ShopProductAdmin,
    f: ProductFilters,
    rules: ShopPublishRules,
    ids: { collections: Set<number> | null; groups: Set<number> | null; brand: Set<number> | null },
): boolean {
    if (ids.collections && !p.collectionIds.some((c) => ids.collections!.has(c))) return false;
    if (ids.groups && (p.groupId == null || !ids.groups.has(p.groupId))) return false;
    if (ids.brand && (p.brandId == null || !ids.brand.has(p.brandId))) return false;
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
    // A view saved before the stages ("ready" / "needs") filters nothing.
    if (f.status !== "all" && STAGES.includes(f.status)) {
        if (productStatus(p, rules).kind !== f.status) return false;
    }
    const q = f.query.trim().toLowerCase();
    if (q && !`${p.name} ${p.sku} ${p.category} ${p.brandName ?? ""} ${p.groupName ?? ""} ${(p.codes ?? []).map((c) => c.value).join(" ")}`.toLowerCase().includes(q))
        return false;
    return true;
}

export type FilterChoice = [value: string, label: string];

/**
 * Dropdown choices for Collection / Brand / Group, by id. Collections and
 * groups come as the indented tree (shared `flattenTree`), trimmed to the
 * nodes that hold a product or sit above one — no dead-end picks.
 */
export function productFilterOptions(
    products: ShopProductAdmin[],
    trees: ProductFilterTrees & { brands: TreeNodeRow[] },
): { categories: FilterChoice[]; brands: FilterChoice[]; groups: FilterChoice[] } {
    const tree = (rows: TreeNodeRow[], used: Set<number>): FilterChoice[] => {
        const byId = new Map(rows.map((r) => [r.id, r]));
        const keep = new Set<number>();
        for (const id of used) {
            for (let cur: number | null | undefined = id; cur != null && !keep.has(cur); cur = byId.get(cur)?.parentId) keep.add(cur);
        }
        return flattenTree(rows.filter((r) => keep.has(r.id))).map((r): FilterChoice => [String(r.id), treeLabel(r)]);
    };
    const usedBrands = new Set(products.map((p) => p.brandId).filter((x): x is number => x != null));
    return {
        categories: tree(trees.categories, new Set(products.flatMap((p) => p.collectionIds))),
        brands: flattenTree(trees.brands.filter((b) => usedBrands.has(b.id))).map((r): FilterChoice => [String(r.id), r.name]),
        groups: tree(trees.groups, new Set(products.map((p) => p.groupId).filter((x): x is number => x != null))),
    };
}
