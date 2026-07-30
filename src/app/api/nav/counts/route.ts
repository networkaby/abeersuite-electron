import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getNavCounts } from "@/shared/lib/nav/navCounts";
import { handleApiError } from "@/shared/lib/api";

/**
 * Every sidebar count badge in one response — { [surface]: { all, new } } — so the
 * sidebar polls once instead of once per badge. Polled from every page.
 */
export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        return NextResponse.json(await getNavCounts(user));
    } catch (e) {
        return handleApiError(e, "Failed to load sidebar counts");
    }
}
