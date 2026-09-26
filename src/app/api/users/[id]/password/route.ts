import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { z } from "zod";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { revokeUserSessions } from "@/shared/lib/auth/revokeSessions";

const schema = z.object({
    password: z.string().min(6, "Password must be at least 6 characters"),
    currentPassword: z.string().optional(),
});

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user: caller, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const userId = Number(id);
    if (Number.isNaN(userId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

    const isSelf  = caller.id === userId;
    const isAdmin = hasPermissionWithScope(caller.permissions, PERMISSIONS.USERS_EDIT);
    if (!isSelf && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        // Your own password needs the current one — an unlocked till must not be
        // enough to take over the account. An admin reset of someone else skips it.
        if (isSelf) {
            const me = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
            if (!me?.password || !data.currentPassword || !(await bcrypt.compare(data.currentPassword, me.password))) {
                return NextResponse.json({ error: "Current password is wrong" }, { status: 400 });
            }
        }
        const hashed = await bcrypt.hash(data.password, 10);
        await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
        // An admin reset someone else's password — the old one must stop working
        // on every device now, not at their next sign-in.
        if (!isSelf) await revokeUserSessions(userId);
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to update password");
    }
}
