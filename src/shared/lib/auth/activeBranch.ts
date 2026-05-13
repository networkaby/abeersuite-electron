import type { Session } from "next-auth";
import type { NextRequest } from "next/server";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const ACTIVE_BRANCH_HEADER = "x-active-branch";
const ACTIVE_BRANCH_COOKIE = "app:active-branch";

type BranchSessionUser = {
    branchIds?: string[];
    permissions?: string[];
};

/** Reads the active branch from the incoming request:
 *   1. x-active-branch header (set by the client axios interceptor / fetch).
 *   2. app:active-branch cookie (fallback when header isn't propagated).
 *   3. First branchId on the session user (default for single-branch users).
 *
 * Throws 400 if the resolved branch isn't accessible to the user (and the user
 * lacks admin:bypass). Returns the branchId string.
 */
export function resolveActiveBranchId(
    request: NextRequest | Request,
    session: Session | null,
): string {
    const user = (session?.user ?? null) as BranchSessionUser | null;
    const allowedBranchIds = user?.branchIds ?? [];
    const isAdmin = (user?.permissions ?? []).includes(PERMISSIONS.ADMIN_BYPASS);

    const headerVal = request.headers.get(ACTIVE_BRANCH_HEADER)?.trim();
    const cookieVal = readCookie(request, ACTIVE_BRANCH_COOKIE);
    const candidate = headerVal || cookieVal || allowedBranchIds[0];

    if (!candidate) {
        throw new BranchAccessError(
            "no_active_branch",
            "No active branch selected and user has no branch assignments.",
        );
    }

    if (!isAdmin && allowedBranchIds.length > 0 && !allowedBranchIds.includes(candidate)) {
        throw new BranchAccessError(
            "forbidden_branch",
            `Active branch ${candidate} is not in user's branch assignments.`,
        );
    }

    return candidate;
}

/** Validate that a user can operate on a specific branch (e.g., for PATCH/POST
 * payloads where branchId came from the body). Throws BranchAccessError on
 * failure.
 */
export function requireBranchAccess(
    session: Session | null,
    branchId: string,
): void {
    const user = (session?.user ?? null) as BranchSessionUser | null;
    const allowedBranchIds = user?.branchIds ?? [];
    const isAdmin = (user?.permissions ?? []).includes(PERMISSIONS.ADMIN_BYPASS);
    if (isAdmin) return;
    if (allowedBranchIds.length === 0 || !allowedBranchIds.includes(branchId)) {
        throw new BranchAccessError(
            "forbidden_branch",
            `User does not have access to branch ${branchId}.`,
        );
    }
}

export class BranchAccessError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = "BranchAccessError";
    }
}

function readCookie(request: NextRequest | Request, name: string): string | null {
    const cookieHeader = request.headers.get("cookie");
    if (!cookieHeader) return null;
    const parts = cookieHeader.split(";").map((p) => p.trim());
    for (const part of parts) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        const key = part.slice(0, eq).trim();
        if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
    }
    return null;
}
