import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { ReplyRefusedError, sendReply } from "@/modules/message/lib/customerMessages";

// POST /api/messages/reply — { phone, text }: a staff reply on WhatsApp.
// Checked at the API (not only the button): every reply is a paid Meta message.

const schema = z.object({
    phone: z.string().trim().min(1),
    text: z.string().trim().min(1, "Type a message").max(4000, "Message is too long"),
});

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const phone = phoneMatchKey(data.phone);
        if (!phone) return NextResponse.json({ error: "Not a valid number" }, { status: 400 });
        const row = await sendReply({ phone, text: data.text, userId: user.id });
        return NextResponse.json({ id: row.id }, { status: 201 });
    } catch (e) {
        if (e instanceof ReplyRefusedError) return NextResponse.json({ error: e.message }, { status: 409 });
        return handleApiError(e, "Failed to send the reply");
    }
}
