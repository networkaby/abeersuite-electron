import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { ensureDirectMessageRoom } from "@/modules/message/lib/inbox";

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ userId: string }> }
) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { userId } = await params;
    const targetId = parseInt(userId, 10);

    if (isNaN(targetId) || targetId === user.id) {
        return NextResponse.json({ error: "Invalid user" }, { status: 400 });
    }

    try {
        const room = await ensureDirectMessageRoom(user.id, targetId);
        return NextResponse.json({ id: room.id });
    } catch (error) {
        console.error("[inbox direct POST]", error);
        return NextResponse.json({ error: "Failed to open DM" }, { status: 500 });
    }
}
