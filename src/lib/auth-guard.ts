import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { hasPermissionWithScope } from "@/lib/permission-scope";

export interface ResolvedUser {
    id:            number;
    primaryRole:   string;
    roles:         string[];
    permissions:   string[];
    departmentIds: string[];
    branchIds:     string[];
}

export function hasPermission(user: ResolvedUser, permissionId: string): boolean {
    return hasPermissionWithScope(user.permissions, permissionId);
}

export function isAdmin(user: ResolvedUser): boolean {
    return hasPermission(user, "admin:bypass");
}

type GuardResult =
    | { user: ResolvedUser; response: null }
    | { user: null; response: NextResponse };

function resolveFromSession(sessionUser: {
    id?: string;
    role?: string;
    roles?: string[];
    permissions?: string[];
    departmentIds?: string[];
    branchIds?: string[];
}): ResolvedUser {
    return {
        id:            Number(sessionUser.id ?? 0),
        primaryRole:   sessionUser.role ?? "",
        roles:         sessionUser.roles ?? [sessionUser.role ?? ""],
        permissions:   sessionUser.permissions ?? [],
        departmentIds: sessionUser.departmentIds ?? [],
        branchIds:     sessionUser.branchIds ?? [],
    };
}

export async function requireAuth(): Promise<GuardResult> {
    const session = await auth();
    if (!session || !session.user) {
        return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    if ((session.user as { kind?: string }).kind === "customer") {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return { user: resolveFromSession(session.user), response: null };
}

export async function requireRole(...roles: string[]): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    if (!roles.includes(result.user.primaryRole)) {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return result;
}

export async function requirePermission(permissionId: string): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    if (!hasPermission(result.user, permissionId)) {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return result;
}
