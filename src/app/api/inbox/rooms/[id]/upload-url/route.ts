import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { isR2Configured, messagesBucket, presignR2 } from "@/shared/lib/storage/r2";
import { checkTeamFile, getAccessibleRoom, teamFileKey } from "@/modules/message/lib/inbox";

// POST /api/inbox/rooms/:id/upload-url — { name, type, size } → { key, putUrl }.
// A 10-minute signed PUT into private R2, so the browser uploads the file
// straight to storage. Saves nothing: POST ../messages then sends `key`.

const schema = z.object({
    name: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(150),
    size: z.number().int().positive(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const room = await getAccessibleRoom(user, id);
        if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
        if (room.type === "SYSTEM_INBOX") return NextResponse.json({ error: "Cannot post to system inbox" }, { status: 403 });

        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        if (!isR2Configured()) return NextResponse.json({ error: "File storage (R2) is not set up on this server." }, { status: 503 });
        const bad = checkTeamFile(data.name, data.size);
        if (bad) return NextResponse.json({ error: bad }, { status: 400 });

        const key = teamFileKey(room.id, data.name);
        const putUrl = presignR2({ bucket: messagesBucket(), key, method: "PUT", contentType: data.type, expiresSec: 600 });
        return NextResponse.json({ key, putUrl });
    } catch (e) {
        return handleApiError(e, "Could not prepare the upload");
    }
}
