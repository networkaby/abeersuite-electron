import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getNavCountsPayload } from "@/shared/lib/nav/navCounts";
import { handleApiError } from "@/shared/lib/api";

/**
 * Every sidebar badge in one response — the per-surface { all, new } counts plus
 * chat unread and the notification-bell count — so the sidebar polls once instead
 * of once per badge. Polled from every page.
 */
export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        return NextResponse.json(await getNavCountsPayload(user));
    } catch (e) {
        return handleApiError(e, "Failed to load sidebar counts");
    }
}
