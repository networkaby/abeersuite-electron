import { MODULE_SECTIONS } from "./constants";

/// Pages that belong to a module by COLOUR but are not sidebar sections.
///
/// MODULE_SECTIONS is the sidebar's own data — adding a pathPrefix there would
/// add or move a navigation entry, which is not what a colour change should do.
/// These paths sit visually inside a module without being their own nav section:
/// /office/settings IS the Settings module, and /office/admin (branches,
/// counters, departments, positions, roles, users, org chart) is the same
/// organisation-administration family as /office/administration.
///
/// Consulted only after MODULE_SECTIONS misses, so a real nav section always
/// wins. Only the two theming components read this — ModuleSurface and
/// BreadcrumbBar — so nothing here can move the sidebar, which does its own
/// pathname matching.
///
/// Longest prefix first, so a narrower path can claim its own hue later.
const THEME_ONLY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
    ["/office/settings", "settings"],
    ["/office/admin", "administration"],
];

export function getActiveModuleKey(pathname: string): string | null {
    for (const mod of MODULE_SECTIONS) {
        const prefixes = mod.pathPrefixes ?? [];
        if (prefixes.some((p) => pathname.startsWith(p))) {
            return mod.key;
        }
    }
    for (const [prefix, key] of THEME_ONLY_PREFIXES) {
        if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
    }
    return null;
}

export function getActiveModule(pathname: string) {
    const key = getActiveModuleKey(pathname);
    if (!key) return null;
    // A theme-only path has no MODULE_SECTIONS entry to return — callers that
    // want the nav section must handle null, exactly as they do for a page
    // outside every module.
    return MODULE_SECTIONS.find((m) => m.key === key) ?? null;
}
