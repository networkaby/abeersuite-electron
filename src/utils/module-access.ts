import type { ModuleChild, ModuleSection } from "./constants";

// Shared module/action visibility gate — used by the Sidebar (which modules to
// list), the ButtonBar, and the All-Create-Actions dialog so all three agree on
// what a user may see. A zero-permission user sees no modules and no actions.

export function canViewModuleChild(child: ModuleChild, permissions: string[], isAdmin: boolean): boolean {
    return !child.permission || isAdmin || permissions.includes(child.permission);
}

// A module is worth showing only if the user can actually open something in it:
// at least one navigable/actionable child (or a descendant of a group child).
function moduleHasVisibleLink(items: ModuleChild[], permissions: string[], isAdmin: boolean): boolean {
    return items.some((child) => {
        if (!canViewModuleChild(child, permissions, isAdmin)) return false;
        if (child.href || child.action) return true;
        if (child.children?.length) return moduleHasVisibleLink(child.children, permissions, isAdmin);
        return false;
    });
}

// Module gate: admin sees all; an explicit `permission` is the sole gate when
// set; otherwise fall back to "has at least one visible child". Replaces the old
// "no permission ⇒ always visible" rule that leaked ungated modules to everyone.
export function canViewModule(mod: ModuleSection, permissions: string[], isAdmin: boolean): boolean {
    if (isAdmin) return true;
    if (mod.permission) return permissions.includes(mod.permission);
    return moduleHasVisibleLink(mod.children, permissions, isAdmin);
}
