import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { ensureDirectMessageRoom } from "@/modules/message/lib/inbox";
import { handleApiError } from "@/shared/lib/api";

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ userId: string }> }
) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { userId } = await params;
    const targetId = parseInt(userId, 10);

    // targetId === user.id is "Message yourself" — a one-member chat for notes and files.
    if (isNaN(targetId) || targetId <= 0) {
        return NextResponse.json({ error: "Invalid user" }, { status: 400 });
    }

    try {
        const room = await ensureDirectMessageRoom(user.id, targetId);
        return NextResponse.json({ id: room.id });
    } catch (e) {
        return handleApiError(e, "Failed to open DM");
    }
}
