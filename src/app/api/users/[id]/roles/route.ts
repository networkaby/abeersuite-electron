import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { revokeUserSessions } from "@/shared/lib/auth/revokeSessions";

const userRoleSchema = z.object({
    roleId: z.string().trim().min(1, "Role is required"),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission(PERMISSIONS.USERS_EDIT_ORG);
    if (response) return response;
    try {
        const { id } = await params;
        const user = await prisma.user.findUnique({
            where: { id: Number(id) },
            select: {
                id: true,
                role: true,
                userRole: true,
            },
        });
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        return NextResponse.json({
            roleId: user.role,
            role: user.userRole,
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch user role");
    }
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission(PERMISSIONS.USERS_EDIT_ORG);
    if (response) return response;
    try {
        const { id } = await params;
        const userId = Number(id);
        const { data, error } = await validateRequest(req, userRoleSchema);
        if (error) return error;
        const { roleId } = data;

        await prisma.user.update({ where: { id: userId }, data: { role: roleId } });
        await revokeUserSessions(userId);

        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to update user role");
    }
}
