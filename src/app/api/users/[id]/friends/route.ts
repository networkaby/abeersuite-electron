import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { getFriendsFor } from "@/shared/lib/social/socialActor";

// GET /api/users/[id]/friends — a staff member's social friends. Implicit model:
// everyone is friends with everyone — all staff plus all joined customers (minus
// this user), resolved as SocialActors.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const userId = Number((await params).id);
    if (!Number.isFinite(userId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    try {
        const friends = await getFriendsFor({ kind: "USER", id: userId });
        return NextResponse.json(friends);
    } catch (e) {
        return handleApiError(e, "Failed to load friends");
    }
}
