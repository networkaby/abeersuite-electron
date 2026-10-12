import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { closeConversation } from "@/modules/message/lib/customerMessages";

// POST /api/messages/conversation — { phone, action: "close" } ends the number's
// open conversation (MessageConversation). The customer's next message starts a
// fresh one and gets the selection menu again. Gated like replying.

const schema = z.object({
    phone: z.string().trim().min(1),
    action: z.literal("close"),
});

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const phone = phoneMatchKey(data.phone);
        if (!phone) return NextResponse.json({ error: "Not a valid number" }, { status: 400 });
        const closed = await closeConversation(phone, "STAFF", user.id);
        return NextResponse.json({ closed });
    } catch (e) {
        return handleApiError(e, "Failed to close the conversation");
    }
}
