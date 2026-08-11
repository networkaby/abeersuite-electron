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
export function moduleTint(key: string | null | undefined, pct = 12): string {
    return `color-mix(in oklab, ${moduleColor(key)} ${pct}%, var(--background))`;
}

/// Coloured glyph on a neutral row — rich but calm. Used for the sidebar icon
/// in its resting state.
export function moduleIconStyle(key?: string | null): CSSProperties {
    return { color: moduleColor(key) };
}

/// The active nav item: tinted pill + a solid bar on the leading edge + the
/// hue as text colour. Replaces a flat primary block, which said "selected"
/// but never said "selected WHAT".
///
/// Mixed against --surface-rail, NOT --background: every caller is a nav rail
/// (sidebar, quick actions bar), and mixing against the page canvas produced a
/// pill only ~2% off the rail it sat on — i.e. no visible selection at all.
/// A selection has to step clearly off ITS OWN surface, so the strength is set
/// against the rail and kept high enough to read at a glance in both themes.
export function moduleActiveStyle(key?: string | null): CSSProperties {
    return {
        backgroundColor: `color-mix(in oklab, ${moduleColor(key)} 30%, var(--surface-rail))`,
        color: moduleColor(key),
        fontWeight: 600,
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
