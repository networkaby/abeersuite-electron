import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

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
        select: { id: true, ownerKind: true, ownerId: true, authorKind: true, authorId: true },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    // Staff caller may delete their own post, a post on their own wall, or (admin) any.
    const isStaffAuthor = post.authorKind === "USER" && post.authorId === caller.id;
    const isStaffOwner  = post.ownerKind === "USER" && post.ownerId === caller.id;
    const canDelete =
        isStaffAuthor ||
        isStaffOwner ||
        caller.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    if (!canDelete) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        await prisma.wallPost.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete post");
    }
}
