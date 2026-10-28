import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { incomingStatus } from "@/modules/incoming/lib/incomingApi";

// GET /api/settings/incoming-api — every outside caller, its switch, where its
// secret comes from (page / env / none) and the last 4 characters. Never a secret.
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_INCOMING_MANAGE);
    if (response) return response;
    try {
        return NextResponse.json(await incomingStatus());
    } catch (e) {
        return handleApiError(e, "Failed to load Incoming API");
    }
}
