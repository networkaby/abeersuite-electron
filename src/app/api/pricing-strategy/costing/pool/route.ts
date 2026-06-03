import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { getPoolSummary } from "@/modules/pricing-strategy/lib/costPool";

// GET /api/pricing-strategy/costing/pool — the additional-cost "waiting" pool.
// Returns the nominated group, its ledgers, the un-settled posted-debit entries
// (remaining > 0), and summary totals. Read-only relative to the GL.
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const summary = await getPoolSummary();
        return NextResponse.json(summary);
    } catch (e) {
        return handleApiError(e, "Failed to load cost pool");
    }
}
