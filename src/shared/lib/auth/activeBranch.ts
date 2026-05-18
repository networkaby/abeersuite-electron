import type { Session } from "next-auth";
import type { NextRequest } from "next/server";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const ACTIVE_BRANCH_HEADER = "x-active-branch";
const ACTIVE_BRANCH_COOKIE = "app:active-branch";

/** Sentinel meaning "all branches accessible to the user."
 * Allowed for read APIs (reports). Rejected for writes — transactions need a
 * concrete operational branch. Mirrors COMBINED_BRANCH in activeBranchStore.
 */
export const COMBINED_BRANCH = "__combined__";

export function isCombined(id: string | null | undefined): boolean {
    return id === COMBINED_BRANCH;
}

type BranchSessionUser = {
    branchIds?: string[];
    permissions?: string[];
};

/** Result of resolving the active branch on a request.
 * - kind="single"  → one concrete branch id; writes and reads both OK.
 * - kind="combined" → the sentinel; reads should union over branchIds; writes
 *   should be rejected via `requireWritableBranch`.
 */
export type ActiveBranch =
    | { kind: "single"; branchId: string }
    | { kind: "combined"; branchIds: string[] };

/** Reads the active branch from the incoming request:
 *   1. x-active-branch header (set by the client http interceptor).
 *   2. app:active-branch cookie (fallback when header isn't propagated).
 *   3. First branchId on the session user (default for single-branch users).
 *
 * Returns the branchId string for back-compat. Use `resolveActiveBranch` if
 * you need to distinguish combined mode from a real branch.
 *
 * Throws BranchAccessError on no_active_branch / forbidden_branch. The
 * combined sentinel is passed through to callers; they decide whether to
 * accept it (reads) or reject it (writes).
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

    // Combined sentinel is always permitted to flow through — caller decides
    // whether the operation is a read (allow) or a write (reject).
    if (candidate === COMBINED_BRANCH) return candidate;

    if (!isAdmin && allowedBranchIds.length > 0 && !allowedBranchIds.includes(candidate)) {
        throw new BranchAccessError(
            "forbidden_branch",
            `Active branch ${candidate} is not in user's branch assignments.`,
        );
    }

    return candidate;
}

/** Resolve into a structured ActiveBranch — preferred for new code.
 * Combined sentinel expands into the user's full branchIds array.
 */
export function resolveActiveBranch(
    request: NextRequest | Request,
    session: Session | null,
): ActiveBranch {
    const raw = resolveActiveBranchId(request, session);
    if (raw === COMBINED_BRANCH) {
        const user = (session?.user ?? null) as BranchSessionUser | null;
        return { kind: "combined", branchIds: user?.branchIds ?? [] };
    }
    return { kind: "single", branchId: raw };
}

/** Require a write-eligible branch context. Rejects the combined sentinel with
 * `select_working_branch` (HTTP 400). Use at the top of transaction-posting
 * API routes (vouchers, payments, POS shift open/close, etc.).
 */
export function requireWritableBranchId(
    request: NextRequest | Request,
    session: Session | null,
): string {
    const id = resolveActiveBranchId(request, session);
    if (id === COMBINED_BRANCH) {
        throw new BranchAccessError(
            "select_working_branch",
            "Switch from 'My branches' to a specific branch to post this transaction.",
        );
    }
    return id;
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
