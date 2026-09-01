import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { getOutboxStatus } from "@/shared/lib/sync/outbox";
import { getReplicaLag } from "@/shared/lib/sync/replicaLag";

/**
 * GET /api/sync/status — both directions of this PC's sync, for the shell badge.
 *
 * UP (`_outbox`): can this cashier trust their last sale actually left this
 * machine? DOWN (`_sync_state` / `_sync_status`): is the replica they are reading
 * from actually being kept in step? The second half had no surface at all before
 * — a replica that quietly stopped receiving looked exactly like a healthy one.
 *
 * Note what is deliberately NOT reported: "the server has rows we have not
 * pulled". Nothing local can know that without querying Supabase, which is the
 * egress this design exists to avoid. See replicaLag.ts.
 *
 * Off a counter PC (no LOCAL_DATABASE_URL or IS_COUNTER_PC=false) there is
 * neither an outbox nor a replica — report isCounter: false so the client hides
 * the badge, same pattern as /api/counter/status.
 */
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    if (!IS_COUNTER_PC || !process.env.LOCAL_DATABASE_URL) {
        return NextResponse.json({
            isCounter: false, pending: 0, failed: 0, retrying: 0, lastSyncedAt: null, replica: null,
        });
    }

    try {
        // Both hit the LOCAL database only, so running them together costs one
        // round trip's latency rather than two and no egress either way.
        const [status, replica] = await Promise.all([
            getOutboxStatus(process.env.LOCAL_DATABASE_URL),
            getReplicaLag(process.env.LOCAL_DATABASE_URL),
        ]);
        return NextResponse.json({ isCounter: true, ...status, replica });
    } catch (e) {
        return handleApiError(e, "Failed to read sync status");
    }
}
