import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { listAccessibleRooms } from "@/modules/message/lib/inbox";
import { handleApiError } from "@/shared/lib/api";

export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const rooms = await listAccessibleRooms(user);
        return NextResponse.json(rooms);
    } catch (e) {
        return handleApiError(e, "Failed to load inbox rooms");
    }
}
