import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { ReplyRefusedError, ticketFromMessage } from "@/modules/message/lib/customerMessages";

// POST /api/messages/[id]/ticket — raise a Help Desk or Deal ticket from this message
// ({ kind: "help" | "deal" }), or join it to an existing ticket ({ ticketId }).
// Maps unlinked messages from this conversation to the ticket. A conversation
// already on a ticket gets that ticket back ({ existing: true }, 200) — a double
// click or two staff at once never make a second one.

const schema = z.object({
    ticketId: z.number().int().positive().optional(),
    kind: z.enum(["help", "deal"]).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const id = Number((await ctx.params).id);
        if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad message id" }, { status: 400 });
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const { ticketId, existing } = await ticketFromMessage(id, user.id, data.ticketId, data.kind);
        return NextResponse.json({ ticketId, existing }, { status: existing ? 200 : 201 });
    } catch (e) {
        if (e instanceof ReplyRefusedError) return NextResponse.json({ error: e.message }, { status: 409 });
        return handleApiError(e, "Failed to raise the ticket");
    }
}
