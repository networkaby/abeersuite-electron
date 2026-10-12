import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { closeConversation, sendMenuAfterTemplate } from "@/modules/message/lib/customerMessages";

// POST /api/messages/conversation — { phone, action: "close" } ends the number's
// open conversation (MessageConversation). The customer's next message starts a
// fresh one and gets the selection menu again; the popup drops the chat.
// { phone, action: "menu" } — the first message after a bill was held back as a
// likely auto-reply (AFTER_TEMPLATE); staff judged it real, so send the menu now.
// Gated like replying.

const schema = z.object({
    phone: z.string().trim().min(1),
    action: z.enum(["close", "menu"]),
});

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const phone = phoneMatchKey(data.phone);
        if (!phone) return NextResponse.json({ error: "Not a valid number" }, { status: 400 });
        if (data.action === "menu") {
            const sent = await sendMenuAfterTemplate(phone);
            if (!sent) return NextResponse.json({ error: "The menu does not apply to this chat any more" }, { status: 409 });
            return NextResponse.json({ sent });
        }
        const closed = await closeConversation(phone, "STAFF", user.id);
        return NextResponse.json({ closed });
    } catch (e) {
        return handleApiError(e, "Failed to close the conversation");
    }
}
