import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { hasPermissionWithScope } from "@/lib/permission-scope";

export interface ResolvedUser {
    id:            number;
    roles:         string[];
    primaryRole:   string;
    permissions:   string[];
    rank:          number;
    scope:         string;
    departmentIds: string[];
    branchIds:     string[];
}

export function hasPermission(user: ResolvedUser, permissionId: string): boolean {
    return hasPermissionWithScope(user.permissions, permissionId);
}

export function isAdmin(user: ResolvedUser): boolean {
    return hasPermission(user, "admin:bypass");
}

type PermissionGuardResult =
    | { user: ResolvedUser; response: null }
    | { user: null; response: NextResponse };

export async function requirePermission(permissionId: string): Promise<PermissionGuardResult> {
    const session = await auth();
    if (!session) {
        return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }

    const sessionUser = session.user as {
        id?: string; role?: string; roles?: string[]; permissions?: string[];
        rank?: number; scope?: string; departmentIds?: string[]; branchIds?: string[];
    };

    const resolved: ResolvedUser = {
        id:            Number(sessionUser.id ?? 0),
        primaryRole:   sessionUser.role ?? "",
        roles:         sessionUser.roles ?? [sessionUser.role ?? ""],
        permissions:   sessionUser.permissions ?? [],
        rank:          sessionUser.rank ?? 0,
        scope:         sessionUser.scope ?? "OWN",
        departmentIds: sessionUser.departmentIds ?? [],
        branchIds:     sessionUser.branchIds ?? [],
    };

    if (!hasPermission(resolved, permissionId)) {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }

    return { user: resolved, response: null };
}

export function resolvedUserFromSession(session: {
    user?: { id?: string; role?: string; roles?: string[]; permissions?: string[]; rank?: number; scope?: string; departmentIds?: string[]; branchIds?: string[] };
}): ResolvedUser {
    const u = session.user ?? {};
    return {
        id:            Number(u.id ?? 0),
        primaryRole:   u.role ?? "",
        roles:         u.roles ?? [u.role ?? ""],
        permissions:   u.permissions ?? [],
        rank:          u.rank ?? 0,
        scope:         u.scope ?? "OWN",
        departmentIds: u.departmentIds ?? [],
        branchIds:     u.branchIds ?? [],
    };
}
