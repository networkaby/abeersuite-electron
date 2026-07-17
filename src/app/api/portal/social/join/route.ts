import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";

// POST /api/portal/social/join — the customer taps "Join" on the Social tab.
// Creates their CustomerSocialProfile (the "has joined" flag). Idempotent: a
// customer who already joined just gets their existing profile back.
const joinSchema = z.object({
    handle: z.string().trim().min(3, "At least 3 characters").max(30, "Max 30 characters")
        .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscore only"),
});

export async function POST(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const { data, error } = await validateRequest(req, joinSchema);
    if (error) return error;

    const handle = data.handle.toLowerCase();

    try {
        const existing = await prisma.customerSocialProfile.findUnique({ where: { personId: customerId! } });
        if (existing) return NextResponse.json(existing);

        const taken = await prisma.customerSocialProfile.findUnique({ where: { handle }, select: { id: true } });
        if (taken) return NextResponse.json({ error: "That nickname is taken." }, { status: 409 });

        const profile = await prisma.customerSocialProfile.create({
            data:   { personId: customerId!, handle },
            select: { handle: true, avatarUrl: true, bio: true, joinedAt: true },
        });
        return NextResponse.json({ joined: true as const, ...profile }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to join social");
    }
}
