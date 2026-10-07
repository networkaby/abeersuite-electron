import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { ReplyRefusedError, ticketFromMessage } from "@/modules/message/lib/customerMessages";

// POST /api/messages/[id]/ticket — raise a Help Desk ticket from this message
// ({}), or join it to an existing ticket ({ ticketId }). Later unlinked messages
// from the same number join the ticket too.

const schema = z.object({ ticketId: z.number().int().positive().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.HELP_CREATE);
    if (response) return response;
    try {
        const id = Number((await ctx.params).id);
        if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad message id" }, { status: 400 });
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const ticketId = await ticketFromMessage(id, user.id, data.ticketId);
        return NextResponse.json({ ticketId }, { status: 201 });
    } catch (e) {
        if (e instanceof ReplyRefusedError) return NextResponse.json({ error: e.message }, { status: 409 });
        return handleApiError(e, "Failed to raise the ticket");
    }
}
