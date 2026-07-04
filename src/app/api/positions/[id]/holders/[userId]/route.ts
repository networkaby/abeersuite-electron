import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string; userId: string }> },
) {
    const { response } = await requireAnyPermission(PERMISSIONS.POSITIONS_EDIT, PERMISSIONS.POSITIONS_MANAGE);
    if (response) return response;
    try {
        const { id: positionId, userId: userIdStr } = await params;
        const userId = Number(userIdStr);
        if (isNaN(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
        await prisma.userPosition.delete({ where: { userId_positionId: { userId, positionId } } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to remove holder");
    }
}
