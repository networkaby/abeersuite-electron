// Storefront home page layout — a flexible registry of section INSTANCES
// (Ecommerce → Customize Home), not a fixed list. Any section type can be
// added more than once, each instance carrying:
//
//   - sectionNo  — which slot on the page it competes for. Page order is
//                  every DISTINCT sectionNo among enabled instances, ascending.
//   - priority   — the tie-breaker within a sectionNo.
//   - startAt/endAt — optional yyyy-mm-dd schedule window.
//
// EVERY SECTION IS SELF-COMPLETE: an instance owns all of its own content and
// renders entirely on its own. Nothing is assembled by combining sibling
// instances at render time. So a hero carousel is ONE hero section holding a
// LIST of slides (each slide with its own display period), not several hero
// sections that happen to share a slot; a promo strip is one section holding
// its own banners. Duplicating a section means "make another whole section",
// never "add a slide".
//
// Resolution per sectionNo group (see resolveHomeSections):
//   1. priority === -1 marks an instance as the group's PERMANENT FALLBACK —
//      its own startAt/endAt is ignored (ineligible for the schedule race in
//      step 2), and at most one instance per sectionNo may hold priority -1
//      (enforced in the Customize Home editor).
//   2. Among the group's other (priority >= 0) instances whose schedule
//      window includes today, the HIGHEST priority wins and renders.
//   3. If none are active today, the group's priority -1 instance (if any)
//      renders. If there isn't one, nothing renders for that sectionNo.
//
// Pure / framework-free on purpose — the Customize Home editor (a client
// component) imports the catalogue and normalizer straight from here. The
// OrgDefaults loader lives in loadHomeLayout.ts instead, so this file never
// pulls `prisma` (and therefore the `pg`/`dns` Node driver) into the client
// bundle.

import {
    HERO_SLIDES,
    PROMO_BANNERS_TOP,
    PROMO_BANNERS_BOTTOM,
    type HeroSlide,
    type PromoBanner,
} from "@/shared/lib/shop/storeContent";

/** Which shared editor/renderer a section type uses. */
export type HomeBlockKind = "banner" | "trust" | "heading" | "productRail" | "stub";

export const HOME_SECTION_TYPES = [
    "hero",
    "promoBanner",
    "shopByNeed",
    "serviceBlock",
    "storeLocator",
    "whatsappStrip",
    "trustStrip",
    "categoryShowcase",
    "productRail",
    "dealOfTheDay",
    "brandStrip",
    "fullCatalog",
    "couponStrip",
    "wishlistNudge",
    "recentPurchases",
    "cartPreview",
    "abandonedCart",
    "recentlyViewed",
    "relatedAlternatives",
] as const;

export type HomeSectionType = (typeof HOME_SECTION_TYPES)[number];

export type HomeSectionTypeDef = {
    type: HomeSectionType;
    label: string;
    kind: HomeBlockKind;
    hint: string;
    /**
     * false = addable and schedulable in the editor, but the storefront
     * doesn't render it yet (the data it needs — cart, view history, order
     * history, coupons — isn't wired up). Renders nothing until it is.
     */
    implemented: boolean;
};

export const HOME_SECTION_TYPE_DEFS: HomeSectionTypeDef[] = [
    { type: "hero", label: "Hero banner", kind: "banner", hint: "Big top image + headline offer.", implemented: true },
    { type: "trustStrip", label: "Trust strip", kind: "trust", hint: "Shipping, returns, support, secure checkout.", implemented: true },
    { type: "categoryShowcase", label: "Category tiles", kind: "heading", hint: "Browse by category — tiles come from your live catalogue.", implemented: true },
    { type: "promoBanner", label: "Promo banner", kind: "banner", hint: "One image + copy banner.", implemented: true },
    { type: "productRail", label: "Product rail", kind: "productRail", hint: "A horizontal row of products picked by a rule.", implemented: true },
    { type: "dealOfTheDay", label: "Deal of the day", kind: "heading", hint: "Single featured discount — product comes from your live catalogue.", implemented: true },
    { type: "brandStrip", label: "Brand strip", kind: "heading", hint: "Manufacturer logos — managed on Ecommerce → Masters.", implemented: true },
    { type: "fullCatalog", label: "Full catalogue", kind: "heading", hint: "Complete browsable product grid with filters.", implemented: true },
    { type: "shopByNeed", label: "Shop by need", kind: "banner", hint: "\"For office\", \"For students\" — a tile linking to a filtered view.", implemented: true },
    { type: "serviceBlock", label: "Service & repair", kind: "banner", hint: "Your repair differentiator — link it to the customer portal.", implemented: true },
    { type: "storeLocator", label: "Visit us", kind: "banner", hint: "Shop photo, address, hours, directions.", implemented: true },
    { type: "whatsappStrip", label: "WhatsApp ordering", kind: "banner", hint: "\"Order or ask on WhatsApp\" strip.", implemented: true },
    { type: "couponStrip", label: "Coupon strip", kind: "heading", hint: "Active coupon codes. Not wired yet — data source pending.", implemented: false },
    { type: "wishlistNudge", label: "Wishlist nudge", kind: "heading", hint: "\"You have N items saved\" for signed-in customers. Not wired yet.", implemented: false },
    { type: "recentPurchases", label: "Buy again", kind: "heading", hint: "Customer's own past orders. Not wired yet.", implemented: false },
    { type: "cartPreview", label: "What's in your cart", kind: "heading", hint: "Mini cart preview. Not wired yet.", implemented: false },
    { type: "abandonedCart", label: "Complete your purchase", kind: "heading", hint: "Nudge for items left in cart. Not wired yet.", implemented: false },
    { type: "recentlyViewed", label: "Recently viewed", kind: "heading", hint: "Customer's own browsing history. Not wired yet.", implemented: false },
    { type: "relatedAlternatives", label: "Related / alternatives", kind: "heading", hint: "Similar or alternative products. Not wired yet.", implemented: false },
];

export function homeSectionTypeDef(type: HomeSectionType): HomeSectionTypeDef {
    return HOME_SECTION_TYPE_DEFS.find((d) => d.type === type)!;
}

export type RailKind = "featured" | "deals" | "newArrivals" | "underPrice" | "category" | "brand" | "bestSellers";

export const RAIL_KINDS: { value: RailKind; label: string; implemented: boolean }[] = [
    { value: "featured", label: "Top picks (badged products)", implemented: true },
    { value: "deals", label: "Today's deals (biggest % off)", implemented: true },
    { value: "newArrivals", label: "New arrivals", implemented: false },
    { value: "underPrice", label: "Under a price", implemented: false },
    { value: "category", label: "One category", implemented: false },
    { value: "brand", label: "One brand", implemented: false },
    { value: "bestSellers", label: "Best sellers", implemented: false },
];

export type TrustIconKey =
    | "truck"
    | "returns"
    | "support"
    | "shield"
    | "location"
    | "wrench"
    | "clock"
    | "phone"
    | "award"
    | "check";

export const TRUST_ICON_KEYS: TrustIconKey[] = [
    "truck",
    "returns",
    "support",
    "shield",
    "location",
    "wrench",
    "clock",
    "phone",
    "award",
    "check",
];

export type TrustContentItem = { icon: TrustIconKey; title: string; desc: string };

/**
 * One image+copy entry inside a `banner`-kind section — a hero slide, or one
 * banner of a promo strip. The section owns a LIST of these, so a hero
 * carousel is one self-complete section rather than several sections that
 * have to be grouped at render time.
 *
 * `startAt`/`endAt` are plain yyyy-mm-dd business dates compared as strings
 * (no timezone maths needed), giving every slide its own display period
 * independent of the section's own schedule: outside its window a slide drops
 * out of the rotation while its siblings keep showing.
 */
export type BannerSlide = {
    id: string;
    eyebrow?: string;
    title: string;
    subtitle?: string;
    imageUrl: string;
    imageAlt?: string;
    ctaLabel?: string;
    ctaHref?: string;
    /** Hero only — the carousel's dot/eyebrow accent colour. */
    accent?: "primary" | "violet" | "emerald" | "amber";
    /** Promo strips only — card aspect ratio. */
    height?: "sm" | "md" | "lg";
    /** yyyy-mm-dd, inclusive. Empty/absent = no start restriction. */
    startAt?: string;
    /** yyyy-mm-dd, inclusive. Empty/absent = never expires. */
    endAt?: string;
};

/**
 * One flexible content bag, reused across every kind — only the fields a
 * given instance's `kind` actually reads are meaningful:
 *   banner:      slides (+ columns for promo strips)
 *   trust:       items
 *   heading:     eyebrow, title, subtitle
 *   productRail: railKind, eyebrow, title, subtitle, accent
 *   stub:        eyebrow, title, subtitle (caption only — no renderer yet)
 */
export type HomeSectionContent = {
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    accent?: "primary" | "violet" | "emerald" | "amber";
    /** banner kind — the section's own slides / banners, each independently scheduled. */
    slides?: BannerSlide[];
    /** Promo strips only — how many banners sit side by side. Hero ignores it. */
    columns?: 1 | 2 | 3;
    items?: TrustContentItem[];
    railKind?: RailKind;
};

export type HomeSectionInstance = {
    id: string;
    type: HomeSectionType;
    /** Admin-facing name — how you tell "Hero — Diwali" apart from "Hero — Evergreen" in the list. */
    label: string;
    sectionNo: number;
    /** Tie-breaker among same-sectionNo instances. -1 = this instance IS the group's permanent fallback (schedule ignored); at most one per sectionNo. */
    priority: number;
    enabled: boolean;
    /** yyyy-mm-dd, inclusive. Empty/absent = no start restriction. */
    startAt?: string;
    /** yyyy-mm-dd, inclusive. Empty/absent = never expires. */
    endAt?: string;
    content: HomeSectionContent;
};

/** `true` when today (yyyy-mm-dd) falls inside the instance's start/end window. */
export function isInstanceActive(inst: Pick<HomeSectionInstance, "startAt" | "endAt">, todayIso: string): boolean {
    if (inst.startAt && inst.startAt > todayIso) return false;
    if (inst.endAt && inst.endAt < todayIso) return false;
    return true;
}

/** Slides whose own display period covers today, in listed order. */
export function activeSlides(content: HomeSectionContent, todayIso: string): BannerSlide[] {
    return (content.slides ?? []).filter((s) => isInstanceActive(s, todayIso));
}

/** `true` for the group's designated permanent fallback — its own schedule is ignored. */
export function isFallbackInstance(inst: Pick<HomeSectionInstance, "priority">): boolean {
    return inst.priority === -1;
}

/**
 * Resolve which single instance (if any) wins a sectionNo group, per the
 * priority/fallback rule described at the top of this file. Exactly one
 * section renders per slot — a section is self-complete, so a carousel comes
 * from ONE hero section's own slide list, never from grouping siblings.
 */
function resolveGroup(group: HomeSectionInstance[], todayIso: string): HomeSectionInstance | null {
    const fallback = group.find(isFallbackInstance) ?? null;
    const scheduled = group.filter((i) => !isFallbackInstance(i));
    const active = scheduled.filter((i) => isInstanceActive(i, todayIso));
    if (active.length > 0) {
        return active.reduce((best, cur) => (cur.priority > best.priority ? cur : best));
    }
    return fallback;
}

/**
 * Group enabled instances by sectionNo, resolve a winner per group, and
 * return the winners ordered by sectionNo ascending — the page's final
 * top-to-bottom section list for this render.
 */
export function resolveHomeSections(instances: HomeSectionInstance[], todayIso: string): HomeSectionInstance[] {
    const enabled = instances.filter((i) => i.enabled);
    const bySectionNo = new Map<number, HomeSectionInstance[]>();
    for (const inst of enabled) {
        const arr = bySectionNo.get(inst.sectionNo) ?? [];
        arr.push(inst);
        bySectionNo.set(inst.sectionNo, arr);
    }
    const sectionNos = [...bySectionNo.keys()].sort((a, b) => a - b);
    const winners: HomeSectionInstance[] = [];
    for (const no of sectionNos) {
        const winner = resolveGroup(bySectionNo.get(no)!, todayIso);
        if (winner) winners.push(winner);
    }
    return winners;
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.trim().length > 0;
}

function newId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Seed the default banner sections from the existing code content, so a
 *  fresh install renders exactly the storefront that shipped before
 *  Customize Home existed — hero as a 3-slide carousel, promo strips as
 *  2-up / 3-up grids. */
const seedSlides = (items: readonly (HeroSlide | PromoBanner)[]): BannerSlide[] => items.map((s) => ({ ...s }));

/**
 * Default instances — the org's home page the moment Customize Home is
 * opened for the first time. Unlike the heading-only types (which have a
 * built-in fallback baked into their component), a `banner`-kind instance
 * with no slides renders nothing — so these need real seed content here.
 */
export const DEFAULT_HOME_INSTANCES: HomeSectionInstance[] = [
    { id: "default-hero", type: "hero", label: "Hero banner", sectionNo: 10, priority: 0, enabled: true, content: {
        slides: seedSlides(HERO_SLIDES),
    } },
    { id: "default-trust", type: "trustStrip", label: "Trust strip", sectionNo: 20, priority: 0, enabled: true, content: {} },
    { id: "default-categories", type: "categoryShowcase", label: "Category tiles", sectionNo: 30, priority: 0, enabled: false, content: {} },
    { id: "default-promo-1", type: "promoBanner", label: "Promo banners — top", sectionNo: 40, priority: 0, enabled: true, content: {
        slides: seedSlides(PROMO_BANNERS_TOP), columns: 2,
    } },
    { id: "default-toppicks", type: "productRail", label: "Top picks", sectionNo: 50, priority: 0, enabled: true, content: {
        railKind: "featured", eyebrow: "Trending", title: "Top picks for you", subtitle: "Hand-picked best sellers across categories.",
    } },
    { id: "default-deal", type: "dealOfTheDay", label: "Deal of the day", sectionNo: 60, priority: 0, enabled: true, content: {} },
    { id: "default-promo-2", type: "promoBanner", label: "Promo banners — bottom", sectionNo: 65, priority: 0, enabled: true, content: {
        slides: seedSlides(PROMO_BANNERS_BOTTOM), columns: 3,
    } },
    { id: "default-todaysdeals", type: "productRail", label: "Today's deals", sectionNo: 70, priority: 0, enabled: true, content: {
        railKind: "deals", eyebrow: "Today's deals", title: "Save big — limited stock", subtitle: "Biggest discounts right now, sorted by % off.", accent: "emerald",
    } },
    { id: "default-brands", type: "brandStrip", label: "Brand strip", sectionNo: 80, priority: 0, enabled: true, content: {} },
    { id: "default-catalog", type: "fullCatalog", label: "Full catalogue", sectionNo: 90, priority: 0, enabled: false, content: {} },
];

function normalizeTrustItem(raw: unknown): TrustContentItem | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (!isNonEmptyString(r.title) || !isNonEmptyString(r.desc)) return null;
    const icon = TRUST_ICON_KEYS.includes(r.icon as TrustIconKey) ? (r.icon as TrustIconKey) : "shield";
    return { icon, title: r.title, desc: r.desc };
}

function normalizeSlide(raw: unknown): BannerSlide | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    // A slide with no title or no image can't render — drop it rather than
    // letting a half-filled row become a broken card on the storefront.
    if (!isNonEmptyString(r.title) || !isNonEmptyString(r.imageUrl)) return null;
    const slide: BannerSlide = { id: isNonEmptyString(r.id) ? r.id : newId(), title: r.title, imageUrl: r.imageUrl };
    if (isNonEmptyString(r.eyebrow)) slide.eyebrow = r.eyebrow;
    if (isNonEmptyString(r.subtitle)) slide.subtitle = r.subtitle;
    if (isNonEmptyString(r.imageAlt)) slide.imageAlt = r.imageAlt;
    if (isNonEmptyString(r.ctaLabel)) slide.ctaLabel = r.ctaLabel;
    if (isNonEmptyString(r.ctaHref)) slide.ctaHref = r.ctaHref;
    if (r.accent === "primary" || r.accent === "violet" || r.accent === "emerald" || r.accent === "amber") {
        slide.accent = r.accent;
    }
    if (r.height === "sm" || r.height === "md" || r.height === "lg") slide.height = r.height;
    if (isNonEmptyString(r.startAt)) slide.startAt = r.startAt;
    if (isNonEmptyString(r.endAt)) slide.endAt = r.endAt;
    return slide;
}

function normalizeContent(raw: unknown): HomeSectionContent {
    if (!raw || typeof raw !== "object") return {};
    const r = raw as Record<string, unknown>;
    const content: HomeSectionContent = {};
    if (isNonEmptyString(r.eyebrow)) content.eyebrow = r.eyebrow;
    if (isNonEmptyString(r.title)) content.title = r.title;
    if (isNonEmptyString(r.subtitle)) content.subtitle = r.subtitle;
    if (r.accent === "primary" || r.accent === "violet" || r.accent === "emerald" || r.accent === "amber") {
        content.accent = r.accent;
    }
    if (Array.isArray(r.slides)) {
        const slides = r.slides.map(normalizeSlide).filter((s): s is BannerSlide => s !== null);
        if (slides.length > 0) content.slides = slides;
    }
    // Back-compat: an earlier shape stored ONE banner's fields directly on the
    // content (title/imageUrl/cta…) instead of a slides list. Fold that into a
    // single slide so an already-saved hero/banner keeps rendering instead of
    // silently going blank. Harmless for other kinds — normalizeSlide requires
    // both a title and an image, which only a banner section ever had.
    if (!content.slides) {
        const legacy = normalizeSlide(r);
        if (legacy) content.slides = [legacy];
    }
    if (r.columns === 1 || r.columns === 2 || r.columns === 3) content.columns = r.columns;
    if (Array.isArray(r.items)) {
        const items = r.items.map(normalizeTrustItem).filter((i): i is TrustContentItem => i !== null);
        if (items.length > 0) content.items = items;
    }
    if (RAIL_KINDS.some((k) => k.value === r.railKind)) content.railKind = r.railKind as RailKind;
    return content;
}

function normalizeInstance(raw: unknown): HomeSectionInstance | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (!HOME_SECTION_TYPES.includes(r.type as HomeSectionType)) return null;
    const type = r.type as HomeSectionType;
    return {
        id: isNonEmptyString(r.id) ? r.id : newId(),
        type,
        label: isNonEmptyString(r.label) ? r.label : homeSectionTypeDef(type).label,
        sectionNo: typeof r.sectionNo === "number" && Number.isFinite(r.sectionNo) ? r.sectionNo : 10,
        priority: typeof r.priority === "number" && Number.isFinite(r.priority) ? r.priority : 0,
        enabled: typeof r.enabled === "boolean" ? r.enabled : true,
        ...(isNonEmptyString(r.startAt) ? { startAt: r.startAt } : {}),
        ...(isNonEmptyString(r.endAt) ? { endAt: r.endAt } : {}),
        content: normalizeContent(r.content),
    };
}

/**
 * Coerce a stored OrgDefaults.storefrontHomeJson value into a clean instance
 * list. Anything that isn't the current `HomeSectionInstance[]` shape
 * (including the earlier fixed-section-list format) resets to
 * DEFAULT_HOME_INSTANCES — nothing of real value was ever saved under the
 * old shape, so a clean reset is safer than a fragile field-by-field migration.
 */
export function normalizeHomeLayout(raw: unknown): HomeSectionInstance[] {
    if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_HOME_INSTANCES.map((i) => ({ ...i }));
    const looksLikeInstances = raw.every(
        (r) => r && typeof r === "object" && "type" in (r as object) && "sectionNo" in (r as object)
    );
    if (!looksLikeInstances) return DEFAULT_HOME_INSTANCES.map((i) => ({ ...i }));
    const out = raw.map(normalizeInstance).filter((i): i is HomeSectionInstance => i !== null);
    return out.length > 0 ? out : DEFAULT_HOME_INSTANCES.map((i) => ({ ...i }));
}

export function newHomeInstance(type: HomeSectionType, sectionNo: number): HomeSectionInstance {
    const def = homeSectionTypeDef(type);
    const content: HomeSectionContent = def.kind === "banner" ? { slides: [newBannerSlide()] } : {};
    return { id: newId(), type, label: def.label, sectionNo, priority: 0, enabled: true, content };
}

/** A blank slide for the editor's "Add slide" button. */
export function newBannerSlide(): BannerSlide {
    return { id: newId(), title: "", imageUrl: "" };
}

// ─── Adapters: BannerSlide → the strict shapes HeroCarousel / PromoBanners
// render. Pure, so both the storefront page (server) and the Customize Home
// live preview (client) build the exact same slide/banner from the same
// content, instead of two components silently drifting apart.

export function toHeroSlide(slide: BannerSlide): HeroSlide {
    return {
        id: slide.id,
        eyebrow: slide.eyebrow ?? "",
        title: slide.title,
        subtitle: slide.subtitle ?? "",
        imageUrl: slide.imageUrl,
        imageAlt: slide.imageAlt ?? slide.title,
        ctaLabel: slide.ctaLabel ?? "Shop now",
        ctaHref: slide.ctaHref ?? "#catalog",
        accent: slide.accent ?? "primary",
    };
}

export function toPromoBanner(slide: BannerSlide): PromoBanner {
    return {
        id: slide.id,
        eyebrow: slide.eyebrow ?? "",
        title: slide.title,
        subtitle: slide.subtitle,
        imageUrl: slide.imageUrl,
        imageAlt: slide.imageAlt ?? slide.title,
        ctaLabel: slide.ctaLabel ?? "Shop now",
        ctaHref: slide.ctaHref ?? "#catalog",
        height: slide.height,
    };
}
