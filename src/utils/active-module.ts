import { MODULE_SECTIONS } from "@/shared/lib/constants/nav";

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
/// Order matters — first match wins, so narrower paths come first and the
/// `/office` catch-all stays LAST.
const THEME_ONLY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
    ["/office/settings", "settings"],
    ["/office/admin", "administration"],

    // The office shell: the home dashboard, the landing page for a user with no
    // position yet, the Workspace inboxes, a colleague's profile and the serial
    // lookup. None of them is a business module, so they share one low-chroma
    // slate instead of borrowing a module's hue and claiming to be it.
    ["/office/message", "workspace"],
    ["/office/work-flow-inbox", "workspace"],
    ["/office/me", "workspace"],
    ["/office/user", "workspace"],
    ["/office/core", "workspace"],
    ["/office/welcome", "workspace"],

    // Catch-all, and it MUST stay last: "/office" prefix-matches every office
    // page. It is safe only because MODULE_SECTIONS is consulted first and
    // because nothing follows it here. The upside is that no office page can be
    // colourless again; the cost is that a new module folder added without a
    // MODULE_SECTIONS entry wears the slate quietly instead of standing out.
    ["/office", "workspace"],
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
