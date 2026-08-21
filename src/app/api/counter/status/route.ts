import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { counterStatus } from "@/shared/lib/prisma/counterMode";
import { refreshReplicaReadiness } from "@/shared/lib/prisma/replicaReadiness";

/**
 * GET /api/counter/status — where this machine is reading from, right now.
 *
 * Feeds the shell badge so the state is visible rather than inferred. A cashier
 * needs to be able to tell "the shop is offline, my sale won't save" apart from
 * "the app is slow", and an outage that only shows up as a failed Save is a support
 * call every time.
 *
 * On Vercel this reports `isCounter: false` and a permanently LIVE mode — the
 * client hook uses that to hide the badge entirely rather than show a meaningless
 * green light on everybody's laptop.
 *
 * Sync freshness (last sync, per-table lag, rows pulled from live today) lands here
 * in Phase 2, once the worker exists to report it.
 */
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        // Ask the replica whether it is trustworthy before reporting. Rate-limited
        // internally to one query per TTL, so polling this endpoint does not turn
        // into a query per request.
        await refreshReplicaReadiness();
        return NextResponse.json(counterStatus());
    } catch (e) {
        return handleApiError(e, "Failed to read counter status");
    }
}
