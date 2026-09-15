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

/// Keys match ModuleSection.key in utils/constants.ts.
const MODULE_VAR: Record<string, string> = {
    repair: "--m-repair",
    pos: "--m-pos",
    help: "--m-help",
    "e-commerce": "--m-ecommerce",
    inventory: "--m-inventory",
    accountancy: "--m-accountancy",
    orders: "--m-orders",
    customers: "--m-customers",
    bi: "--m-bi",
    crm: "--m-crm",
    administration: "--m-administration",
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

/// The open tab of a detail pane. A tinted pill in the module hue with a hue
/// underline, rather than the solid dark block a `default` Button gives: the
/// tab still reads as selected, but stops being the heaviest thing on a screen
/// whose real content is the table underneath it.
///
/// Returns undefined for an inactive tab so the caller can spread it straight
/// onto every tab without a conditional.
export function moduleTabStyle(key: string | null | undefined, active: boolean): CSSProperties | undefined {
    if (!active) return undefined;
    return {
        backgroundColor: moduleTint(key, 22),
        color: moduleColor(key),
        fontWeight: 600,
        boxShadow: `inset 0 -2px 0 ${moduleColor(key)}`,
    };
}
