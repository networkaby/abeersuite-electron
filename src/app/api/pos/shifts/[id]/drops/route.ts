// POST /api/pos/shifts/[id]/drops
//
// Mid-shift cash drop — staff puts cash into the safe partway through the
// shift to reduce drawer risk. This is **log only**; no GL movement happens
// (from the books' standpoint the cash is still "in the till" account until
// shift close). The closing Contra at end-of-shift moves the entire till
// balance to the vault in one go.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { touchPosShift } from "@/modules/pos/lib/touchShift";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const dropSchema = z.object({
    amountPaise: z.number().int().positive(),
    notes:       z.string().trim().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_DROP);
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, dropSchema);
    if (error) return error;

    try {
        const shift = await prisma.posShift.findUnique({
            where:  { id: shiftId },
            select: { id: true, userId: true, status: true },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status !== "OPEN") {
            return NextResponse.json({ error: "Cannot drop on a closed shift" }, { status: 409 });
        }

        const canManage = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (shift.userId !== user!.id && !canManage) {
            return NextResponse.json({ error: "Not your shift" }, { status: 403 });
        }

        const drop = await prisma.posCashDrop.create({
            data: {
                shiftId,
                amountPaise: BigInt(data.amountPaise),
                droppedById: user!.id,
                notes:       data.notes ?? null,
            },
            include: { droppedBy: { select: { id: true, name: true } } },
        });
        await touchPosShift(prisma, shiftId);

        return NextResponse.json({ ...drop, amountPaise: drop.amountPaise.toString() }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to record drop");
    }
}
