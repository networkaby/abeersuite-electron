import type { CSSProperties } from "react";

// One hue per office module. The hue is NAVIGATION, not decoration — the same
// colour marks a module in the sidebar, its hub card and its page header, so
// the operator learns "Accountancy is teal-green" and stops reading labels.
//
// The hues themselves live in globals.css as --m-* tokens (light + dark
// variants), so a theme change is one file. Colours are applied by inline
// style rather than a Tailwind class because the module key is dynamic and
// Tailwind can only generate classes it can see at build time — the same
// approach entityColor.ts already uses for DB-supplied colours.
//
// Deliberately separate from the grid-row colours in gridRow.ts: inside a data
// grid amber/sky/primary mean unsaved/selected/active, and a module hue must
// never compete with that. Chrome is colourful, data stays meaningful.
//
// ── Three rules the office-wide rollout must keep ────────────────────────────
//
// 1. HUE SAYS WHICH MODULE. Nothing else may vary it. The twelve tokens sit at
//    exactly 30° apart across the wheel, so there is no thirteenth hue that is
//    not a near-twin of an existing module — and the sidebar is an always-on
//    legend that a per-page hue would contradict on every page.
//
// 2. A RAW HUE IS NEVER BODY TEXT. Measured on the live app, a module hue used
//    as a 14px label on its own tinted pill runs 3.0–3.6:1 against that pill —
//    under the 4.5:1 AA floor. Use moduleInk() for any text; the raw hue is for
//    icons, 2–3px bars and underlines, chip borders, and large bold headings.
//
// 3. NEVER A DATA SURFACE. No table-cell background, badge fill or chart
//    series. The module hue goes on the surface BEHIND data, never on the data.

/// Keys match ModuleSection.key in constants/nav.ts.
///
/// `orders` has no pages — nothing in MODULE_SECTIONS carries that key — but it
/// is live as an ACTION colour (the Sales/Purchase Order buttons in the create
/// dialog), so the token stays and must not be recycled for a page module.
///
/// `retention` and `pricing-strategy` are real modules with real pages. Until
/// they were given hues they fell through to --primary, which sits two degrees
/// from --m-bi — so those twelve pages wore a washed-out Business Intelligence
/// blue, which reads as a wrong answer rather than as no answer. Their hues sit
/// beside the family they belong to on purpose: retention (245) next to
/// customers (230) because it IS customer loyalty, and pricing-strategy (125)
/// between e-commerce (110) and inventory (140) because it prices that stock.
const MODULE_VAR: Record<string, string> = {
    // Not a module — the office shell. Home, Welcome, the Workspace inboxes, a
    // colleague's profile and the serial lookup are the furniture the modules
    // sit inside, so they share one low-chroma slate rather than borrowing a
    // module's hue and claiming to be it.
    workspace: "--m-workspace",
    repair: "--m-repair",
    pos: "--m-pos",
    help: "--m-help",
    "e-commerce": "--m-ecommerce",
    "pricing-strategy": "--m-pricing-strategy",
    inventory: "--m-inventory",
    accountancy: "--m-accountancy",
    orders: "--m-orders",
    customers: "--m-customers",
    retention: "--m-retention",
    bi: "--m-bi",
    crm: "--m-crm",
    administration: "--m-administration",
    hr: "--m-hr",
    settings: "--m-settings",
};

/// The module's colour as a CSS value. Unknown/absent key → the theme primary,
/// so a new module added to constants.ts still renders sensibly before it gets
/// its own hue.
export function moduleColor(key?: string | null): string {
    const v = key ? MODULE_VAR[key] : undefined;
    return `var(${v ?? "--primary"})`;
}

/// A soft wash of the module hue over the page background — opaque, so it can
/// sit under sticky/frozen chrome without ghosting.
///
/// `base` is the surface the wash is mixed into, and it must be the surface the
/// tinted element actually sits on — the same rule moduleActiveStyle and
/// moduleSelectedStyle already follow. Default is the page canvas; a breadcrumb
/// or card strip passes `var(--surface-raised)`, otherwise the tint comes out
/// darker than the strip it is painting and reads as a smudge.
export function moduleTint(key: string | null | undefined, pct = 12, base = "var(--background)"): string {
    return `color-mix(in oklab, ${moduleColor(key)} ${pct}%, ${base})`;
}

/// Coloured glyph on a neutral row — rich but calm. Used for the sidebar icon
/// in its resting state.
export function moduleIconStyle(key?: string | null): CSSProperties {
    return { color: moduleColor(key) };
}

/// The active nav item: tinted pill + a solid bar on the leading edge + bold,
/// near-white text. Replaces a flat primary block, which said "selected" but
/// never said "selected WHAT".
///
/// Text goes to --foreground rather than the module hue: a mid-brightness hue
/// as body text reads as only mildly emphasised at nav-label size, which is
/// what "active" must NOT look like. Full-brightness bold text is the actual
/// highlight; the hue still carries the module identity through the pill tint
/// and the left bar (and through the icon, which stays hue-coloured at rest).
///
/// Built from --surface-rail, NOT --background: every caller is a nav rail
/// (sidebar, quick actions bar), and mixing against the page canvas produced a
/// pill only ~2% off the rail it sat on — i.e. no visible selection at all.
/// A selection has to step clearly off ITS OWN surface.
///
/// The pill goes DEEPER than the rail rather than lighter. The rail is a
/// mid-light saturated blue, so tinting it with a light module hue moved it
/// toward the text and dropped white-on-pill to ~4.1:1 (under AA) while barely
/// separating from the rail. Darkening first, then tinting, gives ~9:1 text and
/// a clear step — and it pairs with hover, which lifts LIGHTER, so the two
/// states move in opposite directions and can never be confused.
export function moduleActiveStyle(key?: string | null): CSSProperties {
    return {
        backgroundColor: `color-mix(in oklab, ${moduleColor(
            key,
        )} 20%, color-mix(in oklab, black 44%, var(--surface-rail)))`,
        color: "var(--foreground)",
        fontWeight: 700,
        boxShadow: `inset 3px 0 0 ${moduleColor(key)}`,
    };
}

/// The selected row of a list panel. Panels sit on a raised (card) surface, so
/// this mixes against --surface-raised — the same reason moduleActiveStyle
/// mixes against the rail. A selection must step off the surface it lives on,
/// never off some other surface's colour.
export function moduleSelectedStyle(key?: string | null): CSSProperties {
    return {
        backgroundColor: `color-mix(in oklab, ${moduleColor(key)} 24%, var(--surface-raised))`,
        boxShadow: `inset 3px 0 0 ${moduleColor(key)}`,
        fontWeight: 600,
    };
}

/// The module hue, deepened far enough to be legible as TEXT.
///
/// The raw hue is tuned to sit on a page, not to be read at 14px: measured on
/// the live app it runs 3.0–3.6:1 against its own tinted pill in light mode,
/// against a 4.5:1 AA floor. Mixing it toward --m-ink-mix lifts every module to
/// 6.6:1 (light) and 6.2:1 (dark) while keeping the colour recognisably itself.
///
/// The mix target has to flip with the theme: deepening toward black is right
/// on a light canvas and collapses to 2.1:1 on a dark one, and lightening does
/// the same in reverse. --m-ink-mix is black in :root and white in .dark, so
/// one recipe serves both — see the token's comment in globals.css.
export function moduleInk(key?: string | null, strength = 72): string {
    return `color-mix(in oklab, ${moduleColor(key)} ${strength}%, var(--m-ink-mix))`;
}

/// The open tab of a detail pane. A tinted pill in the module hue with a hue
/// underline, rather than the solid dark block a `default` Button gives: the
/// tab still reads as selected, but stops being the heaviest thing on a screen
/// whose real content is the table underneath it.
///
/// Mixed against --surface-raised because a tab strip sits on a card, not on
/// the page canvas — mixing against --background gave a pill fractionally
/// DARKER than the strip it painted, which is exactly the smudge moduleTint's
/// own comment warns about.
///
/// Returns undefined for an inactive tab so the caller can spread it straight
/// onto every tab without a conditional.
export function moduleTabStyle(key: string | null | undefined, active: boolean): CSSProperties | undefined {
    if (!active) return undefined;
    return {
        backgroundColor: moduleTint(key, 22, "var(--surface-raised)"),
        color: moduleInk(key),
        fontWeight: 600,
        boxShadow: `inset 0 -2px 0 ${moduleColor(key)}`,
    };
}

/// A table's header row, tinted in the module hue.
///
/// OPAQUE on purpose: a sticky header scrolls its own body underneath itself,
/// and a translucent tint would let the rows ghost through. Mixed against
/// --card because every table in the office sits on one.
export function moduleTableHeadStyle(key?: string | null): CSSProperties {
    return { backgroundColor: moduleTint(key, 10, "var(--card)") };
}
