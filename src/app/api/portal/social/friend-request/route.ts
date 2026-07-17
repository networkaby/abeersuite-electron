import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";

// POST /api/portal/social/friend-request — send a friend request to another
// joined customer.
const schema = z.object({ personId: z.number().int().positive() });

export async function POST(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    if (data.personId === customerId) return NextResponse.json({ error: "You can't friend yourself." }, { status: 400 });

    const target = await prisma.customerSocialProfile.findUnique({ where: { personId: data.personId }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "That customer hasn't joined social." }, { status: 404 });

    const existing = await prisma.socialConnection.findFirst({
        where: {
            OR: [
                { requesterId: customerId!, addresseeId: data.personId },
                { requesterId: data.personId, addresseeId: customerId! },
            ],
        },
        select: { requesterId: true, status: true },
    });
    if (existing) {
        if (existing.status === "ACCEPTED") return NextResponse.json({ error: "You're already friends." }, { status: 409 });
        if (existing.requesterId === customerId) return NextResponse.json({ error: "Request already sent." }, { status: 409 });
        return NextResponse.json({ error: "They already sent you a request — accept it from Requests." }, { status: 409 });
    }

    try {
        await prisma.socialConnection.create({ data: { requesterId: customerId!, addresseeId: data.personId, status: "PENDING" } });
        return NextResponse.json({ status: "pending_out" }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to send request");
    }
}
