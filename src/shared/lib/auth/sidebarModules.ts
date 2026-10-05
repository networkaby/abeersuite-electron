import { WORKSPACE_NAV, MODULE_SECTIONS, ADMIN_NAV, SETTINGS_NAV } from "@/shared/lib/constants/nav";
import { MOBILE_SCREENS } from "@/modules/mobile/lib/mobileScreens";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

/**
 * Sidebar visibility matrix — the single source of truth for who sees what in the
 * sidebar, to the FULL depth of the nav tree:
 *
 *   • Department picker → toggles a whole MODULE (Contacts, Inventory, CRM…),
 *     pooling every nav-link id under it (all depths).
 *   • Role page → goes *inside* a module and ticks which links show, including
 *     nested sub-nav (e.g. Accountancy → Masters → Ledgers).
 *
 * Permission family: `ui:sidebar:<moduleKey>:<linkKey>` — one id per nav link at
 * any depth. Kept separate from the "can do things here" keys (`customers:view`,
 * `accountancy:view`…) so visibility and capability stay independent.
 *
 * Derived from the Workspace group (WORKSPACE_NAV) + MODULE_SECTIONS + the two
 * "Admin Only" groups (ADMIN_NAV / SETTINGS_NAV) so the picker never drifts from
 * the real sidebar.
 */
export const sidebarChildPermissionId = (moduleKey: string, childKey: string) =>
    `ui:sidebar:${moduleKey}:${childKey}`;

const slug = (label: string) =>
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Any nav node — matches ModuleChild / NavItem structurally (label + optional children).
// `sidebarKey` overrides the label-derived slug so a display-label rename doesn't
// change the `ui:sidebar:*` permission id (which would silently drop grants).
type NavLike = {
    label: string;
    sidebarKey?: string;
    href?: string;
    pathPrefixes?: readonly string[];
    children?: readonly NavLike[];
};

export interface SidebarChildRow {
    key: string;
    label: string;
    permissionId: string;
    /** The link's address plus any `pathPrefixes` — the pages its tick opens (pageAccess.ts). */
    paths: string[];
    /** Nested sub-nav links (e.g. Masters → Ledgers), same shape, any depth. */
    children?: SidebarChildRow[];
}

export interface SidebarModuleRow {
    key: string;
    label: string;
    /** Child nav links (recursive) — every link the Role page can tick. */
    children: SidebarChildRow[];
    /** Every link id under this module at all depths — what a Department chip pools. */
    childPermissionIds: string[];
    /**
     * Whether a Department pools this module. `true` (default) → it's a Department
     * chip and the Role picker only offers its links if the dept pooled them.
     * `false` (Workspace) → always available (default-yes, no dept chip); the Role
     * picker offers its links directly and enforcement is authoritative (untick = hide).
     */
    pooled: boolean;
    /** What its links are called in the Role page's count ("5 screens"); default "links". */
    unit?: string;
    /** A line the Role page prints under the module's name. */
    note?: string;
    /**
     * `true` → the links carry permission ids that already exist in the catalog under
     * their own module (not `ui:sidebar:*`), so `sidebarPermissionSeeds()` skips them.
     */
    ownIds?: boolean;
}

// Recursively model a module's nav tree. `seen` is shared across the whole module
// so link keys stay unique even across depths.
function makeChildren(moduleKey: string, items: readonly NavLike[], seen: Set<string>): SidebarChildRow[] {
    return items.map((it) => {
        let childKey = it.sidebarKey ?? slug(it.label);
        while (seen.has(childKey)) childKey = `${childKey}-x`;
        seen.add(childKey);
        return {
            key: childKey,
            label: it.label,
            permissionId: sidebarChildPermissionId(moduleKey, childKey),
            paths: [it.href, ...(it.pathPrefixes ?? [])].filter((p): p is string => !!p),
            children: it.children?.length ? makeChildren(moduleKey, it.children, seen) : undefined,
        };
    });
}

const flattenIds = (rows: SidebarChildRow[]): string[] =>
    rows.flatMap((r) => [r.permissionId, ...(r.children ? flattenIds(r.children) : [])]);

function makeModule(key: string, label: string, items: readonly NavLike[], pooled = true): SidebarModuleRow {
    const children = makeChildren(key, items, new Set());
    return { key, label, children, childPermissionIds: flattenIds(children), pooled };
}

/**
 * The staff phone app (/m-staff-app) as a module of the Role and Departments pages.
 * It has no office menu, so its "links" are the phone screens (mobileScreens.ts —
 * still the only list of them) and each link's id is the screen's own `mobile:*`
 * tick, so existing grants carry over. Not in MODULE_SECTIONS: the desktop sidebar
 * never shows it.
 */
const MOBILE_APP_MODULE: SidebarModuleRow = (() => {
    // First row: the module's own gate — sign in to the app (auth/phoneOnly.ts). Not a
    // screen, so it is listed here and not in MOBILE_SCREENS.
    const gate: SidebarChildRow = { key: "access", label: "Can use Mobile App", permissionId: PERMISSIONS.MOBILE_APP_ACCESS, paths: [] };
    const children: SidebarChildRow[] = [gate, ...MOBILE_SCREENS.map((s) => ({
        key: s.href.slice(s.href.lastIndexOf("/") + 1),
        label: s.label,
        permissionId: s.permission,
        paths: [],
    }))];
    return {
        key: "mobile",
        label: "Mobile App",
        children,
        childPermissionIds: flattenIds(children),
        pooled: true,
        unit: "ticks",
        note: "“Can use Mobile App” lets them sign in to the phone app only — never the office website. “Can login outside counter” (Global, above) opens the phone app too. Quick Receive / Pay / Expense use the Receipt and Payment create + post ticks.",
        ownIds: true,
    };
})();

/** Sidebar top-level modules, in sidebar order, each with its nav tree. */
export const SIDEBAR_MODULES: SidebarModuleRow[] = [
    // Workspace is default-yes (not department-pooled) — the Role picks its contents.
    makeModule("workspace", "Workspace", WORKSPACE_NAV, false),
    ...MODULE_SECTIONS.map((m) => makeModule(m.key, m.label, m.children)),
    makeModule("admin", "Admin", ADMIN_NAV),
    makeModule("settings", "Settings", SETTINGS_NAV),
    MOBILE_APP_MODULE,
];

/** Every sidebar-link permission id (all depths) — used to keep them out of the loose pool rows. */
export const ALL_SIDEBAR_MODULE_PERMISSION_IDS: string[] =
    SIDEBAR_MODULES.flatMap((m) => m.childPermissionIds);

// Lookup: (moduleKey, nav label) → the link's permission id, at any depth. The
// sidebar resolves a nav node to its `ui:sidebar:*` id this way (nodes carry a
// label, not the id). Returns null for unmodelled links.
const LINK_ID_BY_MODULE_LABEL = new Map<string, string>();
for (const m of SIDEBAR_MODULES) {
    const walk = (rows: SidebarChildRow[]) => {
        for (const r of rows) {
            LINK_ID_BY_MODULE_LABEL.set(`${m.key}::${r.label}`, r.permissionId);
            if (r.children) walk(r.children);
        }
    };
    walk(m.children);
}

/** The `ui:sidebar:*` id for a nav link (any depth) under a module, by its label. */
export function sidebarLinkPermissionIdForLabel(moduleKey: string, label: string): string | null {
    return LINK_ID_BY_MODULE_LABEL.get(`${moduleKey}::${label}`) ?? null;
}

/**
 * Permission rows for every sidebar link (all depths), for the bootstrap seed — one
 * row per `ui:sidebar:<module>:<link>` id so the Department pool + Role picker can
 * save them. Module `ui` keeps them out of the CRUD matrix and loose chips.
 */
export function sidebarPermissionSeeds(): { id: string; label: string; module: string; description: string }[] {
    const out: { id: string; label: string; module: string; description: string }[] = [];
    for (const mod of SIDEBAR_MODULES) {
        // Phone screens already have catalog rows of their own (module "mobile").
        if (mod.ownIds) continue;
        const walk = (rows: SidebarChildRow[], trail: string) => {
            for (const r of rows) {
                const path = trail ? `${trail} → ${r.label}` : r.label;
                out.push({
                    id: r.permissionId,
                    label: `${mod.label} → ${path}`,
                    module: "ui",
                    description: `Show the "${r.label}" link under ${mod.label}${trail ? ` (${trail})` : ""} in the sidebar.`,
                });
                if (r.children) walk(r.children, path);
            }
        };
        walk(mod.children, "");
    }
    return out;
}
