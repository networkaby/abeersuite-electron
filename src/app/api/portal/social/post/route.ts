import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { resolveSocialActors, socialKey } from "@/shared/lib/social/socialActor";

// POST /api/portal/social/post — the signed-in customer posts to their OWN wall
// (author = owner = this Person). Must have joined first.
const postSchema = z.object({
    body: z.string().trim().min(1, "Message is required").max(1000, "Max 1000 characters"),
});

export async function POST(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const joined = await prisma.customerSocialProfile.findUnique({ where: { personId: customerId! }, select: { id: true } });
    if (!joined) return NextResponse.json({ error: "Join social first." }, { status: 403 });

    const { data, error } = await validateRequest(req, postSchema);
    if (error) return error;

    try {
        const row = await prisma.wallPost.create({
            data:   { ownerKind: "PERSON", ownerId: customerId!, authorKind: "PERSON", authorId: customerId!, body: data.body },
            select: { id: true, body: true, createdAt: true, ownerKind: true, ownerId: true, authorKind: true, authorId: true },
        });
        const actors = await resolveSocialActors([
            { kind: row.authorKind, id: row.authorId },
            { kind: row.ownerKind, id: row.ownerId },
        ]);
        return NextResponse.json({
            id: row.id, body: row.body, createdAt: row.createdAt,
            author: actors.get(socialKey(row.authorKind, row.authorId))!,
            owner:  actors.get(socialKey(row.ownerKind, row.ownerId))!,
        }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to post");
    }
}
