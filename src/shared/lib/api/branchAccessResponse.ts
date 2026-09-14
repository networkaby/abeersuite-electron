import { NextResponse } from "next/server";
import type { BranchAccessError } from "@/shared/lib/auth/activeBranch";

/**
 * The one answer to a `BranchAccessError` (thrown by `requireBranchAccess` /
 * `resolveActiveBranchId`). Every route that resolves a branch before its main
 * `try` used to hand-roll this — and drifted on the status (403 vs 400) and
 * never put the machine code on the wire, so `http.ts`'s branch toasts could
 * not fire.
 *
 * Shape is additive: `error` stays the human sentence (every screen already
 * shows that), `code` carries the machine reason for the interceptor.
 *
 *   forbidden_branch       → 403 (the user is not allowed on that branch)
 *   no_active_branch       → 400 (no working branch selected yet)
 *   select_working_branch  → 400 (posting needs one specific branch)
 */
export function branchAccessResponse(e: BranchAccessError): NextResponse {
    return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.code === "forbidden_branch" ? 403 : 400 },
    );
}
