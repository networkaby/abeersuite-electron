import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getAccessibleRoom, markRoomRead } from "@/modules/message/lib/inbox";
import { handleApiError } from "@/shared/lib/api";

const readSchema = z.object({
    readAt: z.string().datetime().optional(),
});

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { id } = await params;
        const room = await getAccessibleRoom(user, id);
        if (!room) {
            return NextResponse.json({ error: "Room not found" }, { status: 404 });
        }

        const raw = await req.json().catch(() => ({}));
        const parsed = readSchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid read payload" }, { status: 400 });
        }

        await markRoomRead(user.id, room.id, parsed.data.readAt ? new Date(parsed.data.readAt) : undefined);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to mark room read");
    }
}
