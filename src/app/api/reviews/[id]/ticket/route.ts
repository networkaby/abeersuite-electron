import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { ReplyRefusedError } from "@/modules/message/lib/customerMessages";
import { ticketFromReview } from "@/modules/reviews/lib/reviewTicket";

// POST /api/reviews/[id]/ticket { kind: "help" | "deal" } — raise a ticket from a
// review (or get the one already raised). Needs the create tick for that kind.

const schema = z.object({ kind: z.enum(["help", "deal"]) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    const { user, response } = await requireAnyPermission(data.kind === "deal" ? PERMISSIONS.DEALS_CREATE : PERMISSIONS.HELP_CREATE);
    if (response) return response;
    try {
        const id = Number((await ctx.params).id);
        if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad review id" }, { status: 400 });
        return NextResponse.json({ ticketId: await ticketFromReview(id, user.id, data.kind) }, { status: 201 });
    } catch (e) {
        if (e instanceof ReplyRefusedError) return NextResponse.json({ error: e.message }, { status: 409 });
        return handleApiError(e, "Failed to raise the ticket");
    }
}
