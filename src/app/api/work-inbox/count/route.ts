import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getWorkInboxCounts } from "@/modules/repairing/lib/workInboxCount";
import { handleApiError } from "@/shared/lib/api";

/** Lean { all, new } counts for the Sidebar Work Flow badge — polled from every page. */
export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        return NextResponse.json(await getWorkInboxCounts(user));
    } catch (e) {
        return handleApiError(e, "Failed to load work inbox counts");
    }
}
