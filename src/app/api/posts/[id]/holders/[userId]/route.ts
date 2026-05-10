import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";

export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string; userId: string }> },
) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { id: postId, userId: userIdStr } = await params;
        const userId = Number(userIdStr);
        if (isNaN(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        await prisma.userPost.delete({ where: { userId_postId: { userId, postId } } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to remove holder" }, { status: 500 });
    }
}
