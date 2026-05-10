import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";

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
