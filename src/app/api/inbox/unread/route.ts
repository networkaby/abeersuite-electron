import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getUnreadTotal } from "@/modules/message/lib/inbox";
import { handleApiError } from "@/shared/lib/api";

/** Lean total-unread count for the Sidebar Inbox badge — polled from every page. */
export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        return NextResponse.json({ total: await getUnreadTotal(user) });
    } catch (e) {
        return handleApiError(e, "Failed to load unread count");
    }
}
