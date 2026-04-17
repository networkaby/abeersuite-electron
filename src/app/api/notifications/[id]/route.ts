import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

// PATCH /api/notifications/[id] — mark one as read
export async function PATCH(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { id } = await params;
        await prisma.notification.update({
            where: { id: Number(id), userId: Number(session.user.id) },
            data: { read: true },
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Failed to mark notification read" }, { status: 500 });
    }
}
