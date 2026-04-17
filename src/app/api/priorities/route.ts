import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const priorities = await prisma.priority.findMany({ orderBy: { order: "asc" } });
        return NextResponse.json(priorities);
    } catch {
        return NextResponse.json({ error: "Failed to fetch priorities" }, { status: 500 });
    }
}
