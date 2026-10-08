import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { phoneMatchKey } from "@/shared/lib/format";
import { changeClaim } from "@/modules/message/lib/customerMessages";

// /api/messages/claim — who is handling a customer's chat (MessageClaim).
//
// GET  — the staff a chat can be handed to or shared with: id + name only,
//        everyone holding a role.
// POST — { phone, action: take | leave }  or  { phone, action: invite | handover, userId }.
// Gated like replying: handling a chat means answering it.

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    try {
        const staff = await prisma.user.findMany({
            where: { role: { not: null } },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
        });
        return NextResponse.json({ staff });
    } catch (e) {
        return handleApiError(e, "Failed to list staff");
    }
}

const schema = z.discriminatedUnion("action", [
    z.object({ phone: z.string().trim().min(1), action: z.literal("take") }),
    z.object({ phone: z.string().trim().min(1), action: z.literal("leave") }),
    z.object({ phone: z.string().trim().min(1), action: z.literal("invite"), userId: z.number().int().positive() }),
    z.object({ phone: z.string().trim().min(1), action: z.literal("handover"), userId: z.number().int().positive() }),
]);

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const { phone: raw, ...action } = data;
        const phone = phoneMatchKey(raw);
        if (!phone) return NextResponse.json({ error: "Not a valid number" }, { status: 400 });
        await changeClaim(phone, user.id, action);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to update who handles this chat");
    }
}
