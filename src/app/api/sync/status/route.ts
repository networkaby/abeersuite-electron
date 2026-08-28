import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { getOutboxStatus } from "@/shared/lib/sync/outbox";

/**
 * GET /api/sync/status — this PC's own pending offline writes, for the shell
 * badge. "Sync done/pending": can this cashier trust their last sale actually
 * left this machine?
 *
 * Off a counter PC (no LOCAL_DATABASE_URL) there is no outbox to ask about —
 * report isCounter: false so the client hides the badge, same pattern as
 * /api/counter/status.
 */
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    if (!IS_COUNTER_PC || !process.env.LOCAL_DATABASE_URL) {
        return NextResponse.json({ isCounter: false, pending: 0, failed: 0, retrying: 0, lastSyncedAt: null });
    }

    try {
        const status = await getOutboxStatus(process.env.LOCAL_DATABASE_URL);
        return NextResponse.json({ isCounter: true, ...status });
    } catch (e) {
        return handleApiError(e, "Failed to read sync status");
    }
}
