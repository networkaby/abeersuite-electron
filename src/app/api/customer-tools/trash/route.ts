import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { listTombstones } from "@/modules/customer/lib/convertParty";

// GET /api/customer-tools/trash — list converted (soft-deleted) tombstone rows
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    // Listing the trash is a read — default-open. Restore/purge writes keep their gates.

    try {
        const rows = await listTombstones();
        return NextResponse.json(rows);
    } catch (error) {
        return handleApiError(error, "Failed to list tombstones");
    }
}
