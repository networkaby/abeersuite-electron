import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// DELETE /api/quick-notes/:id — only the owner can delete
export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const noteId = parseInt(id, 10);
        if (isNaN(noteId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

        // Verify ownership before deleting
        const note = await prisma.quickNote.findUnique({ where: { id: noteId }, select: { userId: true } });
        if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (note.userId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

        await prisma.quickNote.delete({ where: { id: noteId } });
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return handleApiError(error);
    }
}
