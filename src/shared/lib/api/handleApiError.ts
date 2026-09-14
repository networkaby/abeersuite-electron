import { NextResponse } from "next/server";
import { OFFLINE_READ_ONLY, isOfflineWriteBlocked } from "@/shared/lib/prisma/offlineError";
import { isVoucherDateError } from "@/shared/lib/accountancy/booksPeriodServer";
import { BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { branchAccessResponse } from "./branchAccessResponse";

/**
 * Generic API error envelope. Logs server-side, returns a 500 NextResponse with
 * the supplied fallback message (the actual error stays in server logs only).
 *
 * Usage:
 *   try { … }
 *   catch (e) { return handleApiError(e, "Failed to fetch invoices"); }
 */
export function handleApiError(e: unknown, fallback = "Internal server error"): NextResponse {
    // A counter PC with no internet refusing a write is an EXPECTED state, not a
    // fault: 503 (temporarily unavailable, try later) rather than 500, and logged at
    // warn so a shop with a flaky line doesn't bury real errors under its own noise.
    // Every route already funnels through here, so this one branch covers the whole
    // API surface without touching a single route file.
    if (isOfflineWriteBlocked(e)) {
        console.warn("[api] refused write while offline:", e.message);
        // The guard writes its messages for the person at the till ("re-open the
        // shift", "do it from an office machine"), so pass them through instead of
        // hiding every refusal behind one generic line.
        return NextResponse.json(
            { error: OFFLINE_READ_ONLY, message: e.message || "Offline — read only. Reconnect to save." },
            { status: 503 },
        );
    }
    // A voucher dated before the books begin here is the user typing the wrong
    // year, not a fault: 422 with the guard's own sentence, which already names
    // both dates and says where that entry belongs. Same single-branch trick as
    // the offline case above — it covers every voucher route at once.
    if (isVoucherDateError(e)) {
        return NextResponse.json({ error: e.message }, { status: 422 });
    }
    // A branch refusal that reached the outer catch — same answer as the routes
    // that resolve their branch up front and call branchAccessResponse() directly.
    if (e instanceof BranchAccessError) {
        return branchAccessResponse(e);
    }
    console.error("[api]", e);
    return NextResponse.json({ error: fallback }, { status: 500 });
}
