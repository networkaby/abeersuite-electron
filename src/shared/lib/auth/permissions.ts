import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";

/**
 * Canonical staff-side resolved-user shape.
 * `rank` (0–100) and `scope` (`"OWN" | "TEAM" | "DEPARTMENT" | "BRANCH" | "REGION" | "ORG"`)
 * carry the role's relative authority and the user's data-visibility radius.
 */
export interface ResolvedUser {
    id:            number;
    primaryRole:   string;
    roles:         string[];
    permissions:   string[];
    rank:          number;
    scope:         string;
    departmentIds: string[];
    branchIds:     string[];
}

type SessionUserShape = {
    id?:            string;
    role?:          string;
    roles?:         string[];
    permissions?:   string[];
    rank?:          number;
    scope?:         string;
    departmentIds?: string[];
    branchIds?:     string[];
};

function resolveFromSession(sessionUser: SessionUserShape): ResolvedUser {
    return {
        id:            Number(sessionUser.id ?? 0),
        primaryRole:   sessionUser.role ?? "",
        roles:         sessionUser.roles ?? [sessionUser.role ?? ""],
        permissions:   sessionUser.permissions ?? [],
        rank:          sessionUser.rank ?? 0,
        scope:         sessionUser.scope ?? "OWN",
        departmentIds: sessionUser.departmentIds ?? [],
        branchIds:     sessionUser.branchIds ?? [],
    };
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

/**
 * Staff API gate — 401 if no session, 403 if the session belongs to a portal customer.
 */
export async function requireAuth(): Promise<GuardResult> {
    const session = await auth();
    if (!session || !session.user) {
        return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    if ((session.user as { kind?: string }).kind === "customer") {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return { user: resolveFromSession(session.user as SessionUserShape), response: null };
}

/** Restrict by primary role label (e.g. `"R1"`, `"R2"`). */
export async function requireRole(...roles: string[]): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    if (!roles.includes(result.user.primaryRole)) {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return result;
}

/**
 * Gate by permission id (e.g. `"settings:manage"`). Chains through `requireAuth`,
 * so portal customers and unauthenticated requests are rejected before the permission check.
 */
export async function requirePermission(permissionId: string): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    if (!hasPermission(result.user, permissionId)) {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return result;
}

/** Build a `ResolvedUser` from a session object without enforcing any guard. */
export function resolvedUserFromSession(session: { user?: SessionUserShape }): ResolvedUser {
    return resolveFromSession(session.user ?? {});
}
