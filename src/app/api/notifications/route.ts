import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

// GET /api/notifications — current user's notifications
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const notifications = await prisma.notification.findMany({
            where: { userId: Number(session.user.id) },
            orderBy: { createdAt: "desc" },
            take: 50,
            include: { ticket: { select: { id: true } } },
        });

        return NextResponse.json(notifications);
    } catch {
        return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
    }
}

// PATCH /api/notifications — mark all as read
export async function PATCH() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        await prisma.notification.updateMany({
            where: { userId: Number(session.user.id), read: false },
            data: { read: true },
        });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Failed to mark notifications read" }, { status: 500 });
    }
}
