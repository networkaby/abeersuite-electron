import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { ReplyRefusedError, addMentionNote } from "@/modules/message/lib/customerMessages";

// POST /api/messages/note — { phone, text, mentionIds }: a staff note that
// @mentions colleagues and passes the chat to them. Never sent to the customer.

const schema = z.object({
    phone: z.string().trim().min(1),
    text: z.string().trim().min(1, "Type a note").max(4000, "Note is too long"),
    mentionIds: z.array(z.number().int().positive()).min(1, "Mention a colleague"),
});

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const phone = phoneMatchKey(data.phone);
        if (!phone) return NextResponse.json({ error: "Not a valid number" }, { status: 400 });
        const row = await addMentionNote({ phone, text: data.text, userId: user.id, mentionIds: data.mentionIds });
        return NextResponse.json({ id: row.id }, { status: 201 });
    } catch (e) {
        if (e instanceof ReplyRefusedError) return NextResponse.json({ error: e.message }, { status: 409 });
        return handleApiError(e, "Failed to save the note");
    }
}
