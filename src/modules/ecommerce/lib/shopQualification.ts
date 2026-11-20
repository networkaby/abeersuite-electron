// Shop qualification — a product is eligible to appear in /shop only once it
// meets the org's **publish rules**. Which fields are required is configurable
// (OrgDefaults.shopPublishRulesJson) instead of hardcoded, so the owner decides
// the bar. Pure / framework-free so it runs on both the server (publish guard,
// public-API filter) and the client (live checklist in the product form). Slug
// is auto-generated on publish, so it is never part of the gate.

import { mustPhotoGaps, readPhotoChecklist } from "@/modules/ecommerce/lib/photoChecklist";

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
    /** Every attribute a sibling variant has filled is filled here too. */
    variantAttrs: boolean;
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
    // On by default (owner, 2026-11-10): an attribute left empty on one variant
    // keeps it Pending, so the option buttons never show a gap.
    variantAttrs: true,
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
    variantAttrs: "Variant attributes filled",
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
        variantAttrs: pick("variantAttrs"),
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
    /** Attributes a sibling variant has filled and this product has not (labels).
     *  Undefined = not checked here (e.g. the storefront, which trusts the stored
     *  isListedInShop flag that the save / family re-check already decided). */
    variantAttrGaps?: string[] | null;
    /** Must photos on the photo checklist neither ticked nor "Not applicable" (labels,
     *  mustPhotoGaps). A missing one fails Product image — a published product goes
     *  Pending, off the shop, until it is added (owner, 2026-11-21). */
    mustPhotoGaps?: string[] | null;
};

export type ShopQualificationResult = {
    qualified: boolean;
    /** Labels of the active requirements still unmet (empty when qualified). */
    missing: string[];
    /** Per-requirement pass/fail for the active rules, for rendering a checklist. */
    checks: { key: ShopRequirementKey; label: string; ok: boolean }[];
};

const REQUIREMENT_CHECKS: Record<ShopRequirementKey, (p: ShopQualifiable) => boolean> = {
    image: (p) => (Boolean(p.imageUrl) || (p.galleryUrls?.length ?? 0) > 0) && !(p.mustPhotoGaps?.length),
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
    variantAttrs: (p) => (p.variantAttrGaps?.length ?? 0) === 0,
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
    "variantAttrs",
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
    > & { photoChecklistJson?: unknown },
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
        mustPhotoGaps: mustPhotoGaps(readPhotoChecklist(raw.photoChecklistJson)),
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
    // The variant rule names the exact attributes ("Colour"), so staff know what to fill.
    const missing = checks
        .filter((c) => !c.ok)
        .flatMap((c) =>
            c.key === "variantAttrs" && p.variantAttrGaps?.length
                ? p.variantAttrGaps
                : c.key === "image" && p.mustPhotoGaps?.length
                  ? [`Must photo missing: ${p.mustPhotoGaps.join(", ")}`]
                  : [c.label]
        );
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

/** "colour" → "Colour", "screen_size" → "Screen size" — the label a gap is shown with. */
export function attrKeyLabel(key: string): string {
    const t = key.replace(/_/g, " ").trim();
    return t ? t[0].toUpperCase() + t.slice(1) : key;
}

/**
 * For each product: the attributes some OTHER member of its variant family has
 * filled and it has not (owner, 2026-11-10 — a sibling's attribute is waiting
 * here until filled). Pure; callers pass every member of the families involved.
 * Products outside a family get no entry.
 */
export function variantAttrGaps(
    rows: { id: number; variantFamilyId: number | null; attrs: Record<string, unknown> | null | undefined }[]
): Map<number, string[]> {
    const filled = (a: Record<string, unknown> | null | undefined) =>
        Object.entries(a ?? {})
            .filter(([, v]) => typeof v === "string" && v.trim())
            .map(([k]) => k);
    const familyKeys = new Map<number, Set<string>>();
    for (const r of rows) {
        if (r.variantFamilyId == null) continue;
        const set = familyKeys.get(r.variantFamilyId) ?? new Set<string>();
        for (const k of filled(r.attrs)) set.add(k);
        familyKeys.set(r.variantFamilyId, set);
    }
    const out = new Map<number, string[]>();
    for (const r of rows) {
        if (r.variantFamilyId == null) continue;
        const own = new Set(filled(r.attrs));
        out.set(r.id, [...(familyKeys.get(r.variantFamilyId) ?? [])].filter((k) => !own.has(k)).map(attrKeyLabel));
    }
    return out;
}
