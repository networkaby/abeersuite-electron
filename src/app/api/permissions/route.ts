import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const permissions = await prismaAuthoritative.permission.findMany({ orderBy: [{ module: "asc" }, { id: "asc" }] });
        return NextResponse.json(permissions);
    } catch (e) {
        return handleApiError(e, "Failed to fetch permissions");
    }
}
