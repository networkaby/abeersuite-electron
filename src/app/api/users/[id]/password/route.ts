import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { z } from "zod";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const schema = z.object({
    password: z.string().min(6, "Password must be at least 6 characters"),
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
    const isAdmin = caller.permissions.includes(PERMISSIONS.USERS_EDIT_ORG) || caller.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    if (!isSelf && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const hashed = await bcrypt.hash(data.password, 10);
        await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to update password");
    }
}
