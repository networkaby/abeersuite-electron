import { productPath, type ShopProductPublic } from "./productPublic";
import { isInstanceActive } from "./homeLayout";

/**
 * Storefront ad inventory — the pool of house ads (Ecommerce → Ads) and the
 * rules that decide which ad fills which spot on the shop.
 *
 * Two kinds of ad live in one list:
 *   static  — an uploaded image + link, made for ONE standard size.
 *   product — drawn from the live catalogue (photo, name, price, saving) and
 *             rendered to fit ANY size; the product is either fixed or picked
 *             by a rule on every visit.
 *
 * A SPOT is a place on a shop page (grid gap, billboard strip, sidebar…).
 * Each spot accepts one or more SIZES in preference order. `AdPicker` walks a
 * page's spots once, in reading order, and hands each spot the best eligible
 * ad — never the same ad twice on a page, never a product that is already on
 * the page, static before product at equal priority, ties rotating per visit.
 *
 * Stored on OrgDefaults.storefrontAdsJson as ShopAd[]; null = DEFAULT_ADS.
 */

// ── Sizes ────────────────────────────────────────────────────────────────────

export type AdSize = "tile" | "wide" | "billboard" | "rectangle" | "halfPage" | "mobile";

export type AdSizeDef = {
    size: AdSize;
    label: string;
    /** Industry name — IAB standard unit, or the shop element it matches. */
    standard: string;
    /** Recommended upload, width × height in px. */
    px: [number, number];
    hint: string;
};

export const AD_SIZE_DEFS: AdSizeDef[] = [
    { size: "tile", label: "Grid tile", standard: "One product card", px: [600, 800], hint: "Fills one empty box at the end of a product row." },
    { size: "wide", label: "Grid wide", standard: "Two product cards", px: [1200, 800], hint: "Fills two empty boxes at the end of a product row." },
    { size: "billboard", label: "Billboard", standard: "IAB Billboard 970×250", px: [970, 250], hint: "Full-width strip — top of the catalog, between groups, product page." },
    { size: "rectangle", label: "Medium rectangle", standard: "IAB Medium Rectangle 300×250", px: [300, 250], hint: "Sidebar under the filters, and the cart's summary column." },
    { size: "halfPage", label: "Half page", standard: "IAB Half Page 300×600", px: [300, 600], hint: "Sidebar, stays in view while the customer scrolls." },
    { size: "mobile", label: "Mobile banner", standard: "IAB Large Mobile Banner 320×100", px: [320, 100], hint: "Phone only — top of the catalog, in place of the billboard." },
];

export const AD_SIZES = AD_SIZE_DEFS.map((d) => d.size) as AdSize[];

export function adSizeDef(size: AdSize): AdSizeDef {
    return AD_SIZE_DEFS.find((d) => d.size === size)!;
}

/** "970×250" — the label the office page and placeholders print. */
export function adSizePx(size: AdSize): string {
    const [w, h] = adSizeDef(size).px;
    return `${w}×${h}`;
}

// ── Spots ────────────────────────────────────────────────────────────────────

export type AdSpot =
    | "catalogTop"
    | "catalogMobileTop"
    | "gridFill"
    | "catalogBetween"
    | "sidebarRect"
    | "sidebarTall"
    | "cart"
    | "productPage"
    | "wishlistFill";

export type AdSpotDef = {
    spot: AdSpot;
    label: string;
    page: "Catalog" | "Cart" | "Product page" | "Wishlist";
    /** Sizes this spot accepts, best first. */
    sizes: AdSize[];
    hint: string;
};

export const AD_SPOT_DEFS: AdSpotDef[] = [
    { spot: "catalogTop", label: "Catalog top", page: "Catalog", sizes: ["billboard"], hint: "Under the page banner, above the filters and grid. Desktop and tablet." },
    { spot: "catalogMobileTop", label: "Catalog top (phone)", page: "Catalog", sizes: ["mobile"], hint: "Same place on a phone — the billboard is too wide there." },
    { spot: "gridFill", label: "Grid gap", page: "Catalog", sizes: ["wide", "tile"], hint: "Empty boxes at the end of a group's last row. Two empty boxes take one wide ad, else two tiles." },
    { spot: "catalogBetween", label: "Between groups", page: "Catalog", sizes: ["billboard"], hint: "A strip after every third product group." },
    { spot: "sidebarRect", label: "Sidebar", page: "Catalog", sizes: ["rectangle"], hint: "Under the filters. Desktop only." },
    { spot: "sidebarTall", label: "Sidebar (tall)", page: "Catalog", sizes: ["halfPage"], hint: "Below the sidebar rectangle. Desktop only." },
    { spot: "cart", label: "Cart summary", page: "Cart", sizes: ["rectangle"], hint: "Under the order summary." },
    { spot: "productPage", label: "Product page", page: "Product page", sizes: ["billboard"], hint: "Between the detail tabs and 'More like this'." },
    { spot: "wishlistFill", label: "Wishlist gap", page: "Wishlist", sizes: ["wide", "tile"], hint: "Same gap rule as the catalog grid." },
];

/** Every third group on the catalog gets a billboard strip after it. */
export const CATALOG_BETWEEN_EVERY = 3;

/** Hard cap so a busy catalog never turns into a wall of ads. */
export const MAX_ADS_PER_PAGE = 6;

// ── The ad record ────────────────────────────────────────────────────────────

export type AdKind = "static" | "product";

export const AD_KINDS: { value: AdKind; label: string; hint: string }[] = [
    { value: "static", label: "Static image", hint: "Your own artwork, made for one size, linking anywhere." },
    { value: "product", label: "Product", hint: "Built from the live catalogue — photo, name, price, saving. Fits every size." },
];

/** How a product ad chooses its product. `fixed` = one chosen product; the rest re-pick on every visit. */
export type AdProductRule = "fixed" | "bestDeal" | "category" | "underPrice";

export const AD_PRODUCT_RULES: { value: AdProductRule; label: string; hint: string }[] = [
    { value: "fixed", label: "One product", hint: "Always this product." },
    { value: "bestDeal", label: "Best deal", hint: "The biggest % off in the shop right now." },
    { value: "category", label: "From a category", hint: "Rotates through the products of one category." },
    { value: "underPrice", label: "Under a price", hint: "The best deal at or below a price." },
];

export type ShopAd = {
    id: string;
    /** Admin-facing name — how you tell "Diwali billboard" from "Evergreen billboard". */
    name: string;
    kind: AdKind;
    enabled: boolean;
    /** Higher wins a spot first. Ties rotate on every visit. */
    priority: number;
    /** yyyy-mm-dd, inclusive. Empty/absent = no start restriction. */
    startAt?: string;
    /** yyyy-mm-dd, inclusive. Empty/absent = never expires. */
    endAt?: string;
    /** Sizes this ad may fill. A static ad is made for one; a product ad is rendered, so it fits any. */
    sizes: AdSize[];
    /** Only fill spots inside this product group (a CCTV ad only in the CCTV rows). Empty = anywhere. */
    category?: string;
    /** Static only. */
    imageUrl?: string;
    imageAlt?: string;
    href?: string;
    /** Product only. */
    rule?: AdProductRule;
    productId?: number;
    /** `category` rule — which category to draw from. */
    ruleCategory?: string;
    /** `underPrice` rule — the ceiling, in paise. */
    maxPricePaise?: number;
    /** Small caption above the product name ("Sponsored pick", "Deal of the week"). */
    eyebrow?: string;
    ctaLabel?: string;
    /** Shipped sample — the code default, drawn from a local placeholder image. */
    sample?: boolean;
};

/** An ad after the picker has chosen it for one spot — everything the renderer needs. */
export type ResolvedAd = {
    /** Unique per placement on the page (an ad never repeats, so the ad id serves). */
    key: string;
    adId: string;
    kind: AdKind;
    size: AdSize;
    /** Static: the artwork. Product: the product's main image. */
    imageUrl: string;
    imageAlt: string;
    href: string;
    product?: ShopProductPublic;
    eyebrow?: string;
    ctaLabel?: string;
    /** Staff preview only — a dashed box marking an unfilled spot. Never rendered for customers. */
    placeholder?: boolean;
};

// ── Normalize (the real sanitiser — the API's zod only guards the outer shape) ─

function isNonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.trim().length > 0;
}

function isAdSize(v: unknown): v is AdSize {
    return typeof v === "string" && (AD_SIZES as string[]).includes(v);
}

function isProductRule(v: unknown): v is AdProductRule {
    return typeof v === "string" && AD_PRODUCT_RULES.some((r) => r.value === v);
}

function newId(): string {
    return Math.random().toString(36).slice(2, 10);
}

function normalizeAd(raw: unknown): ShopAd | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const kind: AdKind = r.kind === "product" ? "product" : "static";
    const sizes = Array.isArray(r.sizes) ? [...new Set(r.sizes.filter(isAdSize))] : [];
    const ad: ShopAd = {
        id: isNonEmptyString(r.id) ? r.id : newId(),
        name: isNonEmptyString(r.name) ? r.name.trim() : "Untitled ad",
        kind,
        enabled: r.enabled === true,
        priority: typeof r.priority === "number" && Number.isFinite(r.priority) ? Math.trunc(r.priority) : 0,
        sizes,
    };
    if (isNonEmptyString(r.startAt)) ad.startAt = r.startAt;
    if (isNonEmptyString(r.endAt)) ad.endAt = r.endAt;
    if (isNonEmptyString(r.category)) ad.category = r.category.trim();
    if (isNonEmptyString(r.eyebrow)) ad.eyebrow = r.eyebrow.trim();
    if (isNonEmptyString(r.ctaLabel)) ad.ctaLabel = r.ctaLabel.trim();
    if (r.sample === true) ad.sample = true;
    if (kind === "static") {
        if (isNonEmptyString(r.imageUrl)) ad.imageUrl = r.imageUrl.trim();
        if (isNonEmptyString(r.imageAlt)) ad.imageAlt = r.imageAlt.trim();
        if (isNonEmptyString(r.href)) ad.href = r.href.trim();
    } else {
        ad.rule = isProductRule(r.rule) ? r.rule : "bestDeal";
        if (typeof r.productId === "number" && Number.isInteger(r.productId)) ad.productId = r.productId;
        if (isNonEmptyString(r.ruleCategory)) ad.ruleCategory = r.ruleCategory.trim();
        if (typeof r.maxPricePaise === "number" && r.maxPricePaise > 0) ad.maxPricePaise = Math.trunc(r.maxPricePaise);
    }
    return ad;
}

/**
 * Sanitize a stored / submitted list. Unknown sizes and malformed rows drop
 * out; duplicate ids keep the first. `null`/garbage = the code default.
 */
export function normalizeAds(raw: unknown): ShopAd[] {
    if (!Array.isArray(raw)) return DEFAULT_ADS.map((a) => ({ ...a, sizes: [...a.sizes] }));
    const seen = new Set<string>();
    const out: ShopAd[] = [];
    for (const item of raw) {
        const ad = normalizeAd(item);
        if (!ad || seen.has(ad.id)) continue;
        seen.add(ad.id);
        out.push(ad);
    }
    return out;
}

// ── Defaults: one switched-off sample per size ───────────────────────────────

/** Local artwork the samples use; also what the staff preview draws in an unfilled spot. */
export function adPlaceholderImage(size: AdSize): string {
    return `/ads/placeholder-${size}.svg`;
}

export const DEFAULT_ADS: ShopAd[] = AD_SIZE_DEFS.map((d) => ({
    id: `sample-${d.size}`,
    name: `Sample — ${d.label} ${adSizePx(d.size)}`,
    kind: "static",
    enabled: false,
    priority: 0,
    sizes: [d.size],
    imageUrl: adPlaceholderImage(d.size),
    imageAlt: `${d.label} sample ad`,
    href: "/shop",
    sample: true,
}));

export function newShopAd(kind: AdKind): ShopAd {
    return kind === "product"
        ? { id: newId(), name: "New product ad", kind, enabled: false, priority: 0, sizes: [...AD_SIZES], rule: "bestDeal", ctaLabel: "Buy now" }
        : { id: newId(), name: "New ad", kind, enabled: false, priority: 0, sizes: ["billboard"] };
}

// ── Readiness ────────────────────────────────────────────────────────────────

/** Why an ad cannot show, or null when it is complete. Same check the office page and the picker use. */
export function adIncompleteReason(ad: ShopAd): string | null {
    if (ad.sizes.length === 0) return "No size chosen";
    if (ad.kind === "static") {
        if (!ad.imageUrl) return "No image";
        if (!ad.href) return "No link";
        return null;
    }
    if (ad.rule === "fixed" && !ad.productId) return "No product chosen";
    if (ad.rule === "category" && !ad.ruleCategory) return "No category chosen";
    if (ad.rule === "underPrice" && !ad.maxPricePaise) return "No price limit";
    return null;
}

/** On, complete, and inside its date window today. */
export function isAdLive(ad: ShopAd, todayIso: string): boolean {
    return ad.enabled && adIncompleteReason(ad) === null && isInstanceActive(ad, todayIso);
}

// ── Product-ad resolution ────────────────────────────────────────────────────

function discountPct(p: ShopProductPublic): number {
    if (!p.mrpPaise || p.mrpPaise <= p.pricePaise) return 0;
    return (p.mrpPaise - p.pricePaise) / p.mrpPaise;
}

/** Candidates for a product ad, best first, with everything already on the page removed. */
function productCandidates(ad: ShopAd, products: ShopProductPublic[], exclude: Set<number>): ShopProductPublic[] {
    const pool = products.filter((p) => p.orderable && !exclude.has(p.id));
    switch (ad.rule) {
        case "fixed":
            return pool.filter((p) => p.id === ad.productId);
        case "category":
            return pool.filter((p) => p.category === ad.ruleCategory);
        case "underPrice":
            return pool.filter((p) => p.pricePaise <= (ad.maxPricePaise ?? 0)).sort((a, b) => discountPct(b) - discountPct(a));
        case "bestDeal":
        default:
            return pool.filter((p) => discountPct(p) > 0).sort((a, b) => discountPct(b) - discountPct(a));
    }
}

// ── The picker ───────────────────────────────────────────────────────────────

/** What a shop page hands its picker — built server-side by `loadShopAdContext`, or fetched by `useShopAdContext`. */
export type ShopAdContext = {
    ads: ShopAd[];
    /** Per-visit rotation seed. */
    adSeed: number;
    /** Staff preview — unfilled spots draw a placeholder. */
    adPreview: boolean;
    todayIso: string;
};

export type AdPickerOptions = {
    todayIso: string;
    /** The catalogue the page is drawn from — product ads pick from it. */
    products: ShopProductPublic[];
    /** Products already visible on the page — a product ad never repeats one. */
    onPageProductIds?: Iterable<number>;
    /** Per-visit rotation seed. Must come from the server on SSR'd pages so hydration matches. */
    seed: number;
    /** Staff preview: unfilled spots get a dashed placeholder unit. */
    showPlaceholders?: boolean;
    maxPerPage?: number;
};

/**
 * One picker per page render. Call `pick` / `fillGap` for each spot in reading
 * order; the picker remembers what it has handed out.
 */
export class AdPicker {
    private readonly usedAds = new Set<string>();
    private readonly usedProducts: Set<number>;
    private served = 0;
    private readonly live: ShopAd[];
    private readonly max: number;

    constructor(
        pool: ShopAd[],
        private readonly opts: AdPickerOptions,
    ) {
        this.live = pool.filter((a) => isAdLive(a, opts.todayIso));
        this.usedProducts = new Set(opts.onPageProductIds ?? []);
        this.max = opts.maxPerPage ?? MAX_ADS_PER_PAGE;
    }

    /** How many real ads have been placed so far. */
    get count(): number {
        return this.served;
    }

    private eligible(size: AdSize, category?: string): ShopAd[] {
        return this.live.filter(
            (a) =>
                !this.usedAds.has(a.id) &&
                a.sizes.includes(size) &&
                (!a.category || (category !== undefined && a.category === category)),
        );
    }

    private resolve(ad: ShopAd, size: AdSize): ResolvedAd | null {
        if (ad.kind === "static") {
            return {
                key: ad.id,
                adId: ad.id,
                kind: "static",
                size,
                imageUrl: ad.imageUrl!,
                imageAlt: ad.imageAlt ?? ad.name,
                href: ad.href!,
                eyebrow: ad.eyebrow,
                ctaLabel: ad.ctaLabel,
            };
        }
        const candidates = productCandidates(ad, this.opts.products, this.usedProducts);
        if (candidates.length === 0) return null;
        // Rules that rank (bestDeal, underPrice) take the top; a plain category
        // draw rotates so every product in it gets its turn.
        const product =
            ad.rule === "category" ? candidates[(this.opts.seed + this.served) % candidates.length] : candidates[0];
        return {
            key: ad.id,
            adId: ad.id,
            kind: "product",
            size,
            imageUrl: product.galleryUrls[0] ?? product.imageUrl ?? "",
            imageAlt: product.displayName,
            href: productPath(product),
            product,
            eyebrow: ad.eyebrow,
            ctaLabel: ad.ctaLabel,
        };
    }

    /**
     * One ad of exactly this size, or null. The spot helpers below call this;
     * the office preview calls it directly to draw an ad at each of its sizes.
     */
    pickSize(size: AdSize, category?: string): ResolvedAd | null {
        if (this.served >= this.max) return null;
        // Priority first; static beats product at equal priority; the remaining
        // tie rotates on the visit seed so every ad gets its turn.
        const ranked = this.eligible(size, category).sort(
            (a, b) => b.priority - a.priority || (a.kind === b.kind ? 0 : a.kind === "static" ? -1 : 1),
        );
        if (ranked.length === 0) return null;
        const top = ranked.filter((a) => a.priority === ranked[0].priority && a.kind === ranked[0].kind);
        const start = (this.opts.seed + this.served) % top.length;
        const order = [...top.slice(start), ...top.slice(0, start), ...ranked.filter((a) => !top.includes(a))];
        for (const ad of order) {
            const resolved = this.resolve(ad, size);
            if (!resolved) continue;
            this.usedAds.add(ad.id);
            if (resolved.product) this.usedProducts.add(resolved.product.id);
            this.served += 1;
            return resolved;
        }
        return null;
    }

    private placeholder(size: AdSize, spot: string): ResolvedAd {
        return {
            key: `placeholder-${spot}-${size}`,
            adId: "",
            kind: "static",
            size,
            imageUrl: adPlaceholderImage(size),
            imageAlt: `${adSizeDef(size).label} placeholder`,
            href: "/office/campaigns/ads",
            placeholder: true,
        };
    }

    /**
     * One ad for a spot — the first size in `sizes` that has an eligible ad.
     * In staff preview an unfilled spot returns a placeholder of the first size.
     */
    pick(spot: AdSpot, category?: string): ResolvedAd | null {
        const sizes = AD_SPOT_DEFS.find((d) => d.spot === spot)!.sizes;
        for (const size of sizes) {
            const ad = this.pickSize(size, category);
            if (ad) return ad;
        }
        return this.opts.showPlaceholders ? this.placeholder(sizes[0], spot) : null;
    }

    /**
     * Fill `gap` empty boxes at the end of a product row (1 or 2). Two boxes
     * prefer one wide ad, else tiles; the sum of widths never exceeds the gap.
     */
    fillGap(gap: number, category: string, spot: AdSpot = "gridFill"): ResolvedAd[] {
        const out: ResolvedAd[] = [];
        let left = Math.max(0, Math.min(2, gap));
        if (left === 2) {
            const wide = this.pickSize("wide", category);
            if (wide) return [wide];
        }
        while (left > 0) {
            const tile = this.pickSize("tile", category);
            if (!tile) break;
            out.push(tile);
            left -= 1;
        }
        if (this.opts.showPlaceholders) {
            if (out.length === 0 && left === 2) return [this.placeholder("wide", `${spot}-${category}`)];
            while (left > 0) {
                out.push({ ...this.placeholder("tile", `${spot}-${category}-${left}`) });
                left -= 1;
            }
        }
        return out;
    }
}

/** Width in grid columns an ad takes — the renderer's `col-span`. */
export function adColumnSpan(size: AdSize): 1 | 2 {
    return size === "wide" ? 2 : 1;
}
