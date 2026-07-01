import { MODULE_SECTIONS, ADMIN_NAV, SETTINGS_NAV } from "@/utils/constants";

/**
 * Sidebar visibility matrix — the single source of truth for who sees what in the
 * sidebar. Mirrors the voucher matrix idea, two levels deep:
 *
 *   • Department picker → toggles a whole MODULE (Contacts, Inventory, CRM…),
 *     pooling that module's child-link ids (all-or-nothing, like a voucher kind
 *     pools its action ids).
 *   • Role page → goes *inside* a pooled module and ticks which CHILD links (the
 *     next-level nav labels) the role shows.
 *
 * Permission family: `ui:sidebar:<moduleKey>:<childKey>` — one id per nav link.
 * Kept separate from the "can do things here" keys (`customers:view`,
 * `accountancy:view:org`…) so visibility and capability stay independent.
 *
 * Derived from MODULE_SECTIONS + the two "Admin Only" groups (ADMIN_NAV /
 * SETTINGS_NAV) so the picker never drifts from the real sidebar.
 */
export const sidebarChildPermissionId = (moduleKey: string, childKey: string) =>
    `ui:sidebar:${moduleKey}:${childKey}`;

const slug = (label: string) =>
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export interface SidebarChildRow {
    key: string;
    label: string;
    permissionId: string;
}

export interface SidebarModuleRow {
    key: string;
    label: string;
    /** Immediate child nav links — the "next level" labels picked per role. */
    children: SidebarChildRow[];
    /** Every child link id — what one Department module chip pools. */
    childPermissionIds: string[];
}

// Only the immediate ("next level") nav labels are modelled — nested grandchildren
// (e.g. Inventory → Masters → Brands) follow their parent for now.
function makeModule(key: string, label: string, items: readonly { label: string }[]): SidebarModuleRow {
    const seen = new Set<string>();
    const children: SidebarChildRow[] = items.map((it) => {
        let childKey = slug(it.label);
        while (seen.has(childKey)) childKey = `${childKey}-x`;
        seen.add(childKey);
        return { key: childKey, label: it.label, permissionId: sidebarChildPermissionId(key, childKey) };
    });
    return { key, label, children, childPermissionIds: children.map((c) => c.permissionId) };
}

/** Sidebar top-level modules, in sidebar order, each with its child links. */
export const SIDEBAR_MODULES: SidebarModuleRow[] = [
    ...MODULE_SECTIONS.map((m) => makeModule(m.key, m.label, m.children)),
    makeModule("admin", "Admin", ADMIN_NAV),
    makeModule("settings", "Settings", SETTINGS_NAV),
];

/** Every sidebar-link permission id — used to keep them out of the loose pool rows. */
export const ALL_SIDEBAR_MODULE_PERMISSION_IDS: string[] =
    SIDEBAR_MODULES.flatMap((m) => m.childPermissionIds);

// Lookup: (moduleKey, nav label) → the link's permission id. The sidebar resolves
// a nav child to its `ui:sidebar:*` id this way (the child objects carry a label,
// not the id). Returns null for unmodelled links (e.g. nested grandchildren).
const LINK_ID_BY_MODULE_LABEL = new Map<string, string>(
    SIDEBAR_MODULES.flatMap((m) => m.children.map((c) => [`${m.key}::${c.label}`, c.permissionId] as const)),
);

/** The `ui:sidebar:*` id for a top-level module's nav link, by its label. */
export function sidebarLinkPermissionIdForLabel(moduleKey: string, label: string): string | null {
    return LINK_ID_BY_MODULE_LABEL.get(`${moduleKey}::${label}`) ?? null;
}

/**
 * Permission rows for every sidebar link, for the bootstrap seed — one row per
 * `ui:sidebar:<module>:<child>` id so the Department pool + Role picker can save
 * them. Mirrors voucherPermissionSeeds(); module `ui` keeps them out of the CRUD
 * matrix and loose chips (both filter the `ui:sidebar:` prefix).
 */
export function sidebarPermissionSeeds(): { id: string; label: string; module: string; description: string }[] {
    return SIDEBAR_MODULES.flatMap((mod) =>
        mod.children.map((child) => ({
            id: child.permissionId,
            label: `${mod.label} → ${child.label}`,
            module: "ui",
            description: `Show the "${child.label}" link under ${mod.label} in the sidebar.`,
        })),
    );
}
