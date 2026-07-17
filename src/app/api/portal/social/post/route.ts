import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { resolveSocialActors, socialKey } from "@/shared/lib/social/socialActor";

// POST /api/portal/social/post — the signed-in customer posts to a wall. Defaults
// to their OWN wall; pass ownerKind + ownerId to write on a friend's (staff or
// another joined customer) wall. Author is always this Person. Must have joined.
const postSchema = z.object({
    body:      z.string().trim().min(1, "Message is required").max(1000, "Max 1000 characters"),
    ownerKind: z.enum(["USER", "PERSON"]).optional(),
    ownerId:   z.number().int().positive().optional(),
}).refine((d) => (d.ownerKind == null) === (d.ownerId == null), {
    message: "ownerKind and ownerId must be provided together",
});

export async function POST(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const joined = await prisma.customerSocialProfile.findUnique({ where: { personId: customerId! }, select: { id: true } });
    if (!joined) return NextResponse.json({ error: "Join social first." }, { status: 403 });

    const { data, error } = await validateRequest(req, postSchema);
    if (error) return error;

    // Default target = own wall.
    const ownerKind = data.ownerKind ?? "PERSON";
    const ownerId = data.ownerId ?? customerId!;

    // Validate the target wall exists (a real staff member, or a joined customer).
    if (ownerKind === "USER") {
        const u = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
        if (!u) return NextResponse.json({ error: "That person no longer exists." }, { status: 404 });
    } else if (ownerId !== customerId) {
        const target = await prisma.customerSocialProfile.findUnique({ where: { personId: ownerId }, select: { id: true } });
        if (!target) return NextResponse.json({ error: "That customer hasn't joined social." }, { status: 404 });
    }

    try {
        const row = await prisma.wallPost.create({
            data:   { ownerKind, ownerId, authorKind: "PERSON", authorId: customerId!, body: data.body },
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
            likeCount: 0, likedByMe: false, commentCount: 0,
        }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to post");
    }
}
