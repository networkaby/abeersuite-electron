import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const permissions = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { id: "asc" }] });
        return NextResponse.json(permissions);
    } catch {
        return NextResponse.json({ error: "Failed to fetch permissions" }, { status: 500 });
    }
}
