import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Notification model has been removed — these routes return empty/ok stubs
// to keep the NotificationBell component from erroring.

export async function GET() {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json([]);
}

export async function PATCH() {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: true });
}
