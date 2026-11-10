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
    brand: boolean;
    mrp: boolean;
    stock: boolean;
    weight: boolean;
};

/** Default rules = the original hardcoded gate (image + description + price). */
export const DEFAULT_SHOP_PUBLISH_RULES: ShopPublishRules = {
    image: true,
    description: true,
    price: true,
    category: false,
    brand: false,
    mrp: false,
    stock: false,
    weight: false,
};

export type ShopRequirementKey = keyof ShopPublishRules;

/** Human labels for each toggleable requirement (used by the settings panel). */
export const SHOP_REQUIREMENT_LABELS: Record<ShopRequirementKey, string> = {
    image: "Product image",
    description: "Description",
    price: "Sale price",
    // Storefront category = the product's own `shopCategory` override, else the
    // office group's name. Either one satisfies this rule, matching what the shop
    // actually displays (productPublic: shopCategory ?? group.name).
    category: "Shop Category (office group)",
    brand: "Brand",
    mrp: "MRP",
    stock: "In stock",
    weight: "Shipping weight",
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
        brand: pick("brand"),
        mrp: pick("mrp"),
        stock: pick("stock"),
        weight: pick("weight"),
    };
}

export type ShopQualifiable = {
    pricePaise?: number | null;
    imageUrl?: string | null;
    galleryUrls?: string[] | null;
    description?: string | null;
    /** Explicit storefront category override (shopCategory). */
    category?: string | null;
    mrpPaise?: number | null;
    /** Tracked stock (null = untracked → always counts as in stock). */
    stock?: number | null;
    /** Per-product backorder override — makes the stock rule moot (still orderable). */
    allowBackorder?: boolean;
    /** Office masters (InvProduct.groupId / brandId). */
    groupId?: number | null;
    brandId?: number | null;
    /** Shipping weight of one unit in grams — drives the courier quote. */
    weightGrams?: number | null;
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
    category: (p) => Boolean(p.category && p.category.trim().length > 0) || p.groupId != null,
    brand: (p) => p.brandId != null,
    mrp: (p) => (p.mrpPaise ?? 0) > 0,
    // Untracked (null/undefined) counts as in stock; tracked must be > 0. A
    // backorder-enabled product is orderable at zero stock, so the rule is skipped.
    stock: (p) =>
        p.allowBackorder === true || p.stock === undefined || p.stock === null || p.stock > 0,
    // Must be set ON the product — the whole point is to stop the courier quote
    // silently falling back to the delivery method's default item weight.
    weight: (p) => (p.weightGrams ?? 0) > 0,
};

const REQUIREMENT_ORDER: ShopRequirementKey[] = [
    "image",
    "description",
    "price",
    "category",
    "brand",
    "mrp",
    "stock",
    "weight",
];

/**
 * Build the qualification input for a storefront surface, which holds the mapped
 * public shape (resolved category + barcode price) but still needs the raw row's
 * office/logistics scalars — those are deliberately not exposed in the public JSON.
 * Keeps the shop pages, /[slug] and the shop APIs on one merge instead of four.
 */
export function storefrontQualifiable(
    raw: Pick<
        ShopQualifiable,
        "groupId" | "brandId" | "stock" | "allowBackorder" | "weightGrams" | "mrpPaise"
    >,
    pub: {
        pricePaise: number;
        imageUrl: string | null;
        galleryUrls: string[];
        description: string | null;
        category: string | null;
    }
): ShopQualifiable {
    // Take the office scalars EXPLICITLY, never `...raw`. Callers pass the whole
    // Prisma row (typed down by the Pick above), and that row carries a `category`
    // RELATION object from `include: { category: … }`. A wholesale spread would put
    // that object over `pub`'s resolved category string, and the category rule then
    // calls .trim() on an object → 500 on every storefront surface.
    return {
        ...pub,
        groupId: raw.groupId,
        brandId: raw.brandId,
        stock: raw.stock,
        allowBackorder: raw.allowBackorder,
        weightGrams: raw.weightGrams,
        mrpPaise: raw.mrpPaise,
    };
}

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

/** What a re-check of every Published product changed (applyPublished.ts → recheckPublished). */
export type RecheckResult = { wentLive: number; wentPending: number; live: number; pending: number };

/** "12 went live · 3 moved to Pending" — or "nothing changed". */
export function recheckMessage(r: RecheckResult): string {
    const parts = [
        r.wentLive ? `${r.wentLive} went live` : "",
        r.wentPending ? `${r.wentPending} moved to Pending` : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : `nothing changed (${r.live} live, ${r.pending} pending)`;
}
