import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { commissionModeSchema } from "@/shared/lib/schemas/hrSchema";
import { ensureStaffProfile } from "@/modules/hr/lib/staffProfileServer";

// PATCH /api/hr/commission/mode — one person's switch: follow the shop scheme
// (GLOBAL), carry their own (OWN), or earn none (OFF). Their own schemes are
// kept whichever way the switch points, so flipping back loses nothing.
export async function PATCH(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;
    const { data: body, error } = await validateRequest(req, commissionModeSchema);
    if (error) return error;
    try {
        const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, name: true } });
        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
        await prisma.$transaction(async (tx) => {
            await ensureStaffProfile(tx, user);
            await tx.staffProfile.update({ where: { userId: body.userId }, data: { commissionMode: body.mode } });
        });
        return NextResponse.json({ ok: true, mode: body.mode });
    } catch (e) {
        return handleApiError(e, "Failed to change the commission mode");
    }
}
