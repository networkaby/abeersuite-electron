import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const priorities = await prisma.priority.findMany({ orderBy: { order: "asc" } });
        return NextResponse.json(priorities);
    } catch {
        return NextResponse.json({ error: "Failed to fetch priorities" }, { status: 500 });
    }
}
