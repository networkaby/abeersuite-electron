import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/authGuard";

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ postId: string }> }
) {
    const { user: caller, response } = await requireAuth();
    if (response) return response;

    const { postId } = await params;
    const id = Number(postId);
    if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

    const post = await prisma.wallPost.findUnique({
        where:  { id },
        select: { id: true, wallUserId: true, authorId: true },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const canDelete =
        caller.id === post.authorId ||
        caller.id === post.wallUserId ||
        caller.permissions.includes("admin:bypass");
    if (!canDelete) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        await prisma.wallPost.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete post" }, { status: 500 });
    }
}
