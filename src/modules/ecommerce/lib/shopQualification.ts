// Shop qualification — a product is eligible to appear in /shop only once it
// meets the org's **publish rules**. Which fields are required is configurable
// (OrgDefaults.shopPublishRulesJson) instead of hardcoded, so the owner decides
// the bar. Pure / framework-free so it runs on both the server (publish guard,
// public-API filter) and the client (live checklist in the product form). Slug
// is auto-generated on publish, so it is never part of the gate.

/** Which product fields are mandatory before a product can be listed in the shop. */
export type ShopPublishRules = {
    image: boolean;
    description: boolean;
    price: boolean;
    category: boolean;
    mrp: boolean;
};

/** Default rules = the original hardcoded gate (image + description + price). */
export const DEFAULT_SHOP_PUBLISH_RULES: ShopPublishRules = {
    image: true,
    description: true,
    price: true,
    category: false,
    mrp: false,
};

export type ShopRequirementKey = keyof ShopPublishRules;

/** Human labels for each toggleable requirement (used by the settings panel). */
export const SHOP_REQUIREMENT_LABELS: Record<ShopRequirementKey, string> = {
    image: "Product image",
    description: "Description",
    price: "Sale price",
    category: "Shop category",
    mrp: "MRP",
};

/** Coerce a stored OrgDefaults.shopPublishRulesJson value into clean rules. */
export function normalizeShopPublishRules(raw: unknown): ShopPublishRules {
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SHOP_PUBLISH_RULES };
    const r = raw as Record<string, unknown>;
    const pick = (k: ShopRequirementKey) =>
        typeof r[k] === "boolean" ? (r[k] as boolean) : DEFAULT_SHOP_PUBLISH_RULES[k];
    return {
        image: pick("image"),
        description: pick("description"),
        price: pick("price"),
        category: pick("category"),
        mrp: pick("mrp"),
    };
}

export type ShopQualifiable = {
    pricePaise?: number | null;
    imageUrl?: string | null;
    galleryUrls?: string[] | null;
    description?: string | null;
    /** Explicit storefront category (shopCategory). */
    category?: string | null;
    mrpPaise?: number | null;
};

export type ShopQualificationResult = {
    qualified: boolean;
    /** Labels of the active requirements still unmet (empty when qualified). */
    missing: string[];
    /** Per-requirement pass/fail for the active rules, for rendering a checklist. */
    checks: { key: ShopRequirementKey; label: string; ok: boolean }[];
};

const REQUIREMENT_CHECKS: Record<ShopRequirementKey, (p: ShopQualifiable) => boolean> = {
    image: (p) => Boolean(p.imageUrl) || (p.galleryUrls?.length ?? 0) > 0,
    description: (p) => Boolean(p.description && p.description.trim().length > 0),
    price: (p) => (p.pricePaise ?? 0) > 0,
    category: (p) => Boolean(p.category && p.category.trim().length > 0),
    mrp: (p) => (p.mrpPaise ?? 0) > 0,
};

const REQUIREMENT_ORDER: ShopRequirementKey[] = ["image", "description", "price", "category", "mrp"];

export function shopQualification(
    p: ShopQualifiable,
    rules: ShopPublishRules = DEFAULT_SHOP_PUBLISH_RULES
): ShopQualificationResult {
    const checks = REQUIREMENT_ORDER.filter((k) => rules[k]).map((k) => ({
        key: k,
        label: SHOP_REQUIREMENT_LABELS[k],
        ok: REQUIREMENT_CHECKS[k](p),
    }));
    const missing = checks.filter((c) => !c.ok).map((c) => c.label);
    return { qualified: missing.length === 0, missing, checks };
}

/**
 * URL-safe storefront handle derived from the product name (with the SKU
 * appended to keep handles distinct across same-named variants). Used to
 * auto-fill `slug` when a qualified product is published without one.
 */
export function slugifyProduct(name: string, sku?: string | null): string {
    const norm = (s: string) =>
        s
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    const base = norm(name);
    const tail = sku ? norm(sku) : "";
    const slug = [base, tail].filter(Boolean).join("-");
    return slug || tail || "product";
}
