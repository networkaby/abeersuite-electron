export type PermissionScope = "own" | "department" | "branch" | "org";

const SCOPE_ORDER: PermissionScope[] = ["own", "department", "branch", "org"];

const LEGACY_TO_SCOPED_ACTIONS: Record<string, string[]> = {
    "customers:manage": ["customers:create", "customers:edit", "customers:delete"],
    "companies:manage": ["companies:create", "companies:edit", "companies:delete"],
    "service-centers:manage": ["service-centers:create", "service-centers:edit", "service-centers:delete"],
    "users:manage": ["users:create", "users:edit", "users:delete"],
    "roles:manage": ["roles:create", "roles:edit", "roles:delete"],
    "settings:manage": ["settings:edit"],
    "settings:statuses": ["settings:statuses:create", "settings:statuses:edit", "settings:statuses:delete"],
    "settings:pipelines": ["settings:pipelines:create", "settings:pipelines:edit", "settings:pipelines:delete"],
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

