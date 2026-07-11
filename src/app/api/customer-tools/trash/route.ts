import { NextResponse } from "next/server";
import { requireAuth, hasPermission, isAdmin } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { listTombstones } from "@/modules/customer/lib/convertParty";

// GET /api/customer-tools/trash — list converted (soft-deleted) tombstone rows
export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    // Env super-admin (admin:bypass) OR explicit customers:hard-delete grant.
    if (!isAdmin(user) && !hasPermission(user, PERMISSIONS.CUSTOMERS_DELETE)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        const rows = await listTombstones();
        return NextResponse.json(rows);
    } catch (error) {
        return handleApiError(error, "Failed to list tombstones");
    }
}
