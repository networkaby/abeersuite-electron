export type PermissionScope = "own" | "department" | "branch" | "org";

const SCOPE_ORDER: PermissionScope[] = ["own", "department", "branch", "org"];

const LEGACY_TO_SCOPED_ACTIONS: Record<string, string[]> = {
    "users:manage": ["users:create", "users:edit", "users:delete"],
    "roles:manage": ["roles:create", "roles:edit", "roles:delete"],
};

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

function hasEquivalentScopedPermission(permissions: Set<string>, permissionId: string): boolean {
    const actions = LEGACY_TO_SCOPED_ACTIONS[permissionId];
    if (!actions) return false;
    return actions.some((action) => permissions.has(action) || hasAnyScopedPermission(permissions, action));
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

export function hasPermissionWithScope(
    permissionsInput: string[],
    permissionId: string,
    allowAdminBypass = true
): boolean {
    const permissions = new Set(permissionsInput);
    if (allowAdminBypass && permissions.has("admin:bypass")) return true;
    if (permissions.has(permissionId)) return true;

    const parts = permissionId.split(":");
    if (parts.length === 3 && isScope(parts[2])) {
        const basePermission = `${parts[0]}:${parts[1]}`;
        if (permissions.has(basePermission)) return true;
        return hasScopedPermissionAtOrAbove(permissions, basePermission, parts[2]);
    }

    if (parts.length === 2) {
        if (hasAnyScopedPermission(permissions, permissionId)) return true;
        if (hasEquivalentScopedPermission(permissions, permissionId)) return true;
    }

    return false;
}

