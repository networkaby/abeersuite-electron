// Storefront home page layout — which of the existing home sections show,
// and in what order (Ecommerce → Customize Home). Same shape as
// shopQualification's publish rules: code owns the section catalogue and
// its defaults, the org only stores an ordered on/off list.
//
// This is deliberately an *ordered list*, not a map — order and visibility
// come from the same field, so dragging a card in the editor is the whole
// mutation. Unknown/missing keys fall back to the code default, so adding a
// new section later (or a stale saved key) never breaks the live storefront.
//
// Pure / framework-free on purpose — the Customize Home editor (a client
// component) imports the catalogue and normalizer straight from here. The
// OrgDefaults loader lives in loadHomeLayout.ts instead, so this file never
// pulls `prisma` (and therefore the `pg`/`dns` Node driver) into the client
// bundle. Mirrors shopQualification.ts (pure) vs publishRules.ts (loader).

/** Every section the home page currently knows how to render. */
export const HOME_SECTION_KEYS = [
    "hero",
    "trustStrip",
    "categoryShowcase",
    "promoBannersTop",
    "topPicks",
    "dealOfTheDay",
    "promoBannersBottom",
    "todaysDeals",
    "brandStrip",
    "fullCatalog",
] as const;

export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

export type HomeSectionConfig = {
    key: HomeSectionKey;
    enabled: boolean;
};

/** Human label + one-line marketing purpose, shown in the editor list. */
export const HOME_SECTION_LABELS: Record<HomeSectionKey, { label: string; hint: string }> = {
    hero: { label: "Hero banner", hint: "Top rotating slides — headline offer." },
    trustStrip: { label: "Trust strip", hint: "Shipping, returns, support, secure checkout." },
    categoryShowcase: { label: "Category tiles", hint: "Browse by category." },
    promoBannersTop: { label: "Promo banners (top)", hint: "2-up banner strip." },
    topPicks: { label: "Top picks", hint: "Trending / best-seller rail." },
    dealOfTheDay: { label: "Deal of the day", hint: "Single featured discount." },
    promoBannersBottom: { label: "Promo banners (bottom)", hint: "3-up banner strip." },
    todaysDeals: { label: "Today's deals", hint: "Biggest discounts rail." },
    brandStrip: { label: "Brand strip", hint: "Manufacturer logos." },
    fullCatalog: { label: "Full catalogue", hint: "Complete browsable product grid with filters." },
};

/**
 * Default order and visibility — matches the page's current hardcoded
 * sequence. categoryShowcase and fullCatalog exist in components already but
 * are currently commented out on the live page, so they default off; turning
 * them on here is the only step needed to bring them back.
 */
export const DEFAULT_HOME_LAYOUT: HomeSectionConfig[] = [
    { key: "hero", enabled: true },
    { key: "trustStrip", enabled: true },
    { key: "categoryShowcase", enabled: false },
    { key: "promoBannersTop", enabled: true },
    { key: "topPicks", enabled: true },
    { key: "dealOfTheDay", enabled: true },
    { key: "promoBannersBottom", enabled: true },
    { key: "todaysDeals", enabled: true },
    { key: "brandStrip", enabled: true },
    { key: "fullCatalog", enabled: false },
];

/**
 * Coerce a stored OrgDefaults.storefrontHomeJson value into a clean, complete
 * layout: every known key present exactly once, in the saved order, any
 * missing key appended at its default position from DEFAULT_HOME_LAYOUT.
 */
export function normalizeHomeLayout(raw: unknown): HomeSectionConfig[] {
    if (!Array.isArray(raw)) return [...DEFAULT_HOME_LAYOUT];

    const seen = new Set<HomeSectionKey>();
    const out: HomeSectionConfig[] = [];

    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const key = (entry as Record<string, unknown>).key;
        if (typeof key !== "string" || !HOME_SECTION_KEYS.includes(key as HomeSectionKey)) continue;
        if (seen.has(key as HomeSectionKey)) continue;
        const enabled = (entry as Record<string, unknown>).enabled;
        out.push({ key: key as HomeSectionKey, enabled: typeof enabled === "boolean" ? enabled : true });
        seen.add(key as HomeSectionKey);
    }

    for (const def of DEFAULT_HOME_LAYOUT) {
        if (!seen.has(def.key)) out.push({ ...def });
    }

    return out;
}
