import { crudSatisfied } from "@/shared/lib/auth/crudLadder";

export type PermissionScope = "own" | "department" | "branch" | "org";

const SCOPE_ORDER: PermissionScope[] = ["own", "department", "branch", "org"];

function isScope(value: string): value is PermissionScope {
    return (SCOPE_ORDER as string[]).includes(value);
}

function hasAnyScopedPermission(permissions: Set<string>, basePermission: string): boolean {
    return SCOPE_ORDER.some((scope) => permissions.has(`${basePermission}:${scope}`));
}

function hasScopedPermissionAtOrAbove(
    permissions: Set<string>,
    basePermission: string,
    requiredScope: PermissionScope
): boolean {
    const idx = SCOPE_ORDER.indexOf(requiredScope);
    if (idx < 0) return false;
    return SCOPE_ORDER.slice(idx).some((scope) => permissions.has(`${basePermission}:${scope}`));
}

/**
 * New-model page-view gate: a user may open a module's pages if they were given
 * ANY of its sidebar nav links (`ui:sidebar:<moduleKey>:*`) — having the UI means
 * they may use it. Admin bypass passes. Finer limits (per-tab, per-action inside
 * the tool, e.g. "can't see Purchase in the daybook") are enforced deeper, not here.
 */
export function hasModuleNavAccess(permissionsInput: string[], moduleKey: string): boolean {
    if (permissionsInput.includes("admin:bypass")) return true;
    const prefix = `ui:sidebar:${moduleKey}:`;
    return permissionsInput.some((p) => p.startsWith(prefix));
}

/**
 * Single sidebar-LINK gate (as opposed to `hasModuleNavAccess`'s whole-module
 * check) — does the user hold this exact `ui:sidebar:<module>:<link>` id, or
 * admin bypass. For in-page tab bars that mirror the left sidebar's own child
 * links (e.g. E-Commerce's Orders/Products/Masters tabs): the sidebar already
 * hides an ungranted link, so a tab bar showing it anyway is the one place the
 * two surfaces can disagree — an order-processor granted only Orders would
 * otherwise still see Products/Masters tabs once inside the module.
 */
export function hasSidebarLinkAccess(permissionsInput: string[], permissionId: string): boolean {
    return permissionsInput.includes("admin:bypass") || permissionsInput.includes(permissionId);
}

/**
 * Split a resource's CRUD grants into the three flags a board UI needs.
 * `resource` is the permission prefix — "tasks", "deals", "help" → checks
 * `tasks:create` / `tasks:edit` / `tasks:delete`. The CRUD ladder applies, so
 * holding only the top rung (`:delete`) satisfies edit and create too.
 *
 * Module nav access (`hasModuleNavAccess`) says whether the user may OPEN the
 * board; these say what they may DO on it. Keep the two apart — collapsing them
 * is what let a sidebar tick alone delete records.
 */
export function crudFlags(permissionsInput: string[], resource: string) {
    return {
        canCreate: hasPermissionWithScope(permissionsInput, `${resource}:create`),
        canEdit: hasPermissionWithScope(permissionsInput, `${resource}:edit`),
        canDelete: hasPermissionWithScope(permissionsInput, `${resource}:delete`),
    };
}

export function hasPermissionWithScope(
    permissionsInput: string[],
    permissionId: string,
    allowAdminBypass = true
): boolean {
    const permissions = new Set(permissionsInput);
    if (allowAdminBypass && permissions.has("admin:bypass")) return true;
    if (permissions.has(permissionId)) return true;
    // CRUD ladder: only the highest rung is stored/carried — an edit/create
    // check passes when a higher rung on the same resource is held.
    if (crudSatisfied(permissions, permissionId)) return true;

    const parts = permissionId.split(":");
    if (parts.length === 3 && isScope(parts[2])) {
        const basePermission = `${parts[0]}:${parts[1]}`;
        if (permissions.has(basePermission)) return true;
        return hasScopedPermissionAtOrAbove(permissions, basePermission, parts[2]);
    }

    if (parts.length === 2 && hasAnyScopedPermission(permissions, permissionId)) return true;

    return false;
}

