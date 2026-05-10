import { NextResponse } from "next/server";

/**
 * Generic API error envelope. Logs server-side, returns a 500 NextResponse with
 * the supplied fallback message (the actual error stays in server logs only).
 *
 * Usage:
 *   try { … }
 *   catch (e) { return handleApiError(e, "Failed to fetch invoices"); }
 */
export function handleApiError(e: unknown, fallback = "Internal server error"): NextResponse {
    console.error("[api]", e);
    return NextResponse.json({ error: fallback }, { status: 500 });
}
