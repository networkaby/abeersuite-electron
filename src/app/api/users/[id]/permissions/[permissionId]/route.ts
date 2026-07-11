import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { revokeUserSessions } from "@/shared/lib/auth/revokeSessions";

// ── DELETE /api/users/[id]/permissions/[permissionId] ───────────────────────
// Removes a user-level override, restoring the role's default for that permission.

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; permissionId: string }> }
) {
    const { response } = await requirePermission(PERMISSIONS.USERS_EDIT);
    if (response) return response;
    try {
        const { id, permissionId } = await params;
        const userId = Number(id);

        await prisma.userPermission.delete({
            where: { userId_permissionId: { userId, permissionId } },
        });
        await revokeUserSessions(userId);

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Override not found or already removed" }, { status: 404 });
    }
}
