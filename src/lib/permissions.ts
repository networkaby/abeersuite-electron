import { auth } from "@/auth";
import { NextResponse } from "next/server";

export interface ResolvedUser {
    id: number;
    roles: string[];
    primaryRole: string;
    permissions: string[];
}

export function hasPermission(user: ResolvedUser, permissionId: string): boolean {
    return user.permissions.includes(permissionId);
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
        id?: string;
        role?: string;
        roles?: string[];
        permissions?: string[];
    };

    const resolved: ResolvedUser = {
        id: Number(sessionUser.id ?? 0),
        primaryRole: sessionUser.role ?? "",
        roles: sessionUser.roles ?? [sessionUser.role ?? ""],
        permissions: sessionUser.permissions ?? [],
    };

    if (!resolved.permissions.includes(permissionId)) {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }

    return { user: resolved, response: null };
}

export function resolvedUserFromSession(session: {
    user?: { id?: string; role?: string; roles?: string[]; permissions?: string[] };
}): ResolvedUser {
    const u = session.user ?? {};
    return {
        id: Number(u.id ?? 0),
        primaryRole: u.role ?? "",
        roles: u.roles ?? [u.role ?? ""],
        permissions: u.permissions ?? [],
    };
}
