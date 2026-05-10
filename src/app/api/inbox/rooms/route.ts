import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { listAccessibleRooms } from "@/modules/message/lib/inbox";

export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const rooms = await listAccessibleRooms(user);
        return NextResponse.json(rooms);
    } catch (error) {
        console.error("[inbox rooms GET]", error);
        return NextResponse.json({ error: "Failed to load inbox rooms" }, { status: 500 });
    }
}
