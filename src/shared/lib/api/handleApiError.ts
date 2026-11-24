import { NextResponse } from "next/server";
import { OFFLINE_READ_ONLY, isOfflineWriteBlocked } from "@/shared/lib/prisma/offlineError";
import { isVoucherDateError } from "@/shared/lib/accountancy/booksPeriodServer";
import { BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { branchAccessResponse } from "./branchAccessResponse";
import { PhoneFormatError } from "@/shared/lib/format/phone";

/**
 * The answer for an error the app KNOWS — the user's situation, not a fault — or
 * null for anything else. handleApiError starts with it; a route that keeps its
 * own reply for unknown errors (the POS sale, imports, backups) calls it first,
 * so an offline counter or a wrong voucher year reads the same everywhere.
 */
export function knownApiError(e: unknown): NextResponse | null {
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
    // A phone that is not one number by the stored-form rule (canonicalPhone):
    // the user's typing, not a fault — 400 with the rule spelled out.
    if (e instanceof PhoneFormatError) {
        return NextResponse.json({ error: e.message, field: "phone" }, { status: 400 });
    }
    return null;
}

/**
 * Generic API error envelope. Logs server-side, returns a 500 NextResponse with
 * the supplied fallback message (the actual error stays in server logs only).
 *
 * Usage:
 *   try { … }
 *   catch (e) { return handleApiError(e, "Failed to fetch invoices"); }
 */
export function handleApiError(e: unknown, fallback = "Internal server error"): NextResponse {
    const known = knownApiError(e);
    if (known) return known;
    console.error("[api]", e);
    return NextResponse.json({ error: fallback }, { status: 500 });
}
