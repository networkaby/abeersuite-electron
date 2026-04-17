import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const roles = await prisma.role.findMany({ orderBy: { id: "asc" } });
        return NextResponse.json(roles);
    } catch {
        return NextResponse.json({ error: "Failed to fetch roles" }, { status: 500 });
    }
}
