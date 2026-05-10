import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/authGuard";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    const roles = await prisma.role.findMany({
        select: { id: true, label: true },
        orderBy: { id: "asc" },
    });
    return NextResponse.json(roles);
}
