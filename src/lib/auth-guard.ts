import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";

type GuardResult =
    | { session: Session; response: null }
    | { session: null; response: NextResponse };

export async function requireAuth(): Promise<GuardResult> {
    const session = await auth();
    if (!session) {
        return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    return { session, response: null };
}

export async function requireRole(...roles: string[]): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    const role = (result.session.user as { role?: string }).role ?? "";
    if (!roles.includes(role)) {
        return { session: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return result;
}

// Permission-based guard — use this in new/updated API routes
export async function requirePermission(permissionId: string): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    const perms = (result.session.user as { permissions?: string[] }).permissions ?? [];
    if (!perms.includes(permissionId)) {
        return { session: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return result;
}
