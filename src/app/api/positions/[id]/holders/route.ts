import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { revokeUserSessions } from "@/shared/lib/auth/revokeSessions";

const assignSchema = z.object({ userId: z.number().int().positive() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.POSITIONS_EDIT, PERMISSIONS.POSITIONS_MANAGE);
    if (response) return response;
    try {
        const { id: positionId } = await params;
        const { data, error } = await validateRequest(req, assignSchema);
        if (error) return error;
        const { userId } = data;
        const existing = await prisma.userPosition.findUnique({ where: { userId_positionId: { userId, positionId } } });
        if (existing) return NextResponse.json({ error: "User already holds this position" }, { status: 409 });
        await prisma.userPosition.create({ data: { userId, positionId } });
        await revokeUserSessions(userId);
        return NextResponse.json({ success: true }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to assign holder");
    }
}
