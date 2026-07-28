import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { runTaskRecurrences } from "@/modules/administration/lib/runTaskRecurrences";

// POST /api/admin-task-recurrences/run
// Admin-triggered sweep ("Generate now" on the Recurring Tasks page). The same
// sweep also runs on every board read, so this is a convenience, not the only
// path. Same shape as the gift-card breakage sweep.
export async function POST() {
    const { response } = await requireModuleAccess("administration");
    if (response) return response;
    try {
        const { generated } = await runTaskRecurrences();
        return NextResponse.json({ ok: true, generated });
    } catch (e) {
        return handleApiError(e, "Failed to generate tasks");
    }
}
