import type { ModuleChild, ModuleSection, ModuleCreateAction } from "@/shared/lib/constants/nav";
import type { ButtonBarAction } from "@/shared/lib/constants/quickActions";
import { VOUCHER_CREATE_PERMISSION_BY_ACTION } from "@/shared/lib/constants/quickActions";
import { crudSatisfied } from "@/shared/lib/auth/crudLadder";

// Shared module/action visibility gate — used by the Sidebar (which modules to
// list), the ButtonBar, and the All-Create-Actions dialog so all three agree on
// what a user may see. A zero-permission user sees no modules and no actions.

// The permission that decides whether a create "+" shows. For a voucher action,
// it's the kind's per-kind CREATE key (so a position sees only the vouchers it may
// create); otherwise the action's own `permission`. Drives the Quick Actions bar.
export function createActionPermission(action: ModuleCreateAction | ButtonBarAction): string | null | undefined {
    return (action.action && VOUCHER_CREATE_PERMISSION_BY_ACTION[action.action]) || action.permission;
}

// True if the user may perform this create action (no perm ⇒ open; admin passes).
// Uses crudSatisfied so a higher stored rung (post/cancel/delete) implies create —
// sessions carry only the highest rung, so a plain includes() would hide the "+".
export function canDoCreateAction(
    action: ModuleCreateAction | ButtonBarAction,
    permissions: string[],
    isAdmin: boolean,
): boolean {
    const perm = createActionPermission(action);
    return !perm || isAdmin || crudSatisfied(permissions, perm);
}

export function canViewModuleChild(child: ModuleChild, permissions: string[], isAdmin: boolean): boolean {
    return !child.permission || isAdmin || crudSatisfied(permissions, child.permission);
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
    if (mod.permission) return crudSatisfied(permissions, mod.permission);
    return moduleHasVisibleLink(mod.children, permissions, isAdmin);
}
