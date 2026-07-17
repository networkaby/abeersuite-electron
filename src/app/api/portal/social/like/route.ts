import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";

// POST /api/portal/social/like — toggle the signed-in customer's like on a post.
const likeSchema = z.object({ postId: z.number().int().positive() });

export async function POST(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const { data, error } = await validateRequest(req, likeSchema);
    if (error) return error;

    try {
        const where = { postId_likerKind_likerId: { postId: data.postId, likerKind: "PERSON" as const, likerId: customerId! } };
        const existing = await prisma.wallPostLike.findUnique({ where });
        if (existing) await prisma.wallPostLike.delete({ where });
        else await prisma.wallPostLike.create({ data: { postId: data.postId, likerKind: "PERSON", likerId: customerId! } });

        const likeCount = await prisma.wallPostLike.count({ where: { postId: data.postId } });
        return NextResponse.json({ liked: !existing, likeCount });
    } catch (e) {
        return handleApiError(e, "Failed to like");
    }
}
