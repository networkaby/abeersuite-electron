// POST /api/pos/shifts/[id]/handover
//
// A initiates a cashier-to-cashier handover. Sets the shift to
// AWAITING_HANDOVER and creates a PENDING PosHandover record.
// NO GL movement at this point — only when B accepts.
//
// Body: { toUserId, declaredCashPaise, carryOverPaise?, notes? }
//
// DELETE /api/pos/shifts/[id]/handover
// Cancel a pending handover. Returns shift to OPEN so A can close normally.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const initiateSchema = z.object({
    toUserId:          z.number().int().positive(),
    declaredCashPaise: z.number().int().min(0),
    carryOverPaise:    z.number().int().min(0).optional().default(0),
    notes:             z.string().trim().max(500).optional(),
});

// ── POST — Initiate handover ─────────────────────────────────────────────────
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_CLOSE);
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, initiateSchema);
    if (error) return error;

    try {
        const shift = await prisma.posShift.findUnique({
            where:   { id: shiftId },
            select:  { id: true, status: true, userId: true, branchId: true, counterId: true },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status !== "OPEN") {
            return NextResponse.json({ error: "Only OPEN shifts can initiate a handover" }, { status: 409 });
        }

        const canManage = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (shift.userId !== user!.id && !canManage) {
            return NextResponse.json({ error: "Not your shift" }, { status: 403 });
        }
        if (data.toUserId === user!.id) {
            return NextResponse.json({ error: "Cannot hand over to yourself" }, { status: 400 });
        }

        // Ensure target user exists and doesn't already have an active shift in this branch.
        const targetUser = await prisma.user.findUnique({
            where:  { id: data.toUserId },
            select: { id: true, name: true },
        });
        if (!targetUser) return NextResponse.json({ error: "Target user not found" }, { status: 404 });

        const targetBusy = await prisma.posShift.findFirst({
            where:  { userId: data.toUserId, branchId: shift.branchId, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
            select: { id: true },
        });
        if (targetBusy) {
            return NextResponse.json(
                { error: `${targetUser.name} already has an active shift in this branch.` },
                { status: 409 },
            );
        }

        // No existing pending handover on this shift.
        const existingHandover = await prisma.posHandover.findUnique({
            where:  { fromShiftId: shiftId },
            select: { id: true, status: true },
        });
        if (existingHandover && existingHandover.status === "PENDING") {
            return NextResponse.json({ error: "A handover is already pending for this shift" }, { status: 409 });
        }

        const result = await prisma.$transaction(async (tx) => {
            const handover = await tx.posHandover.create({
                data: {
                    fromShiftId:      shiftId,
                    toUserId:         data.toUserId,
                    declaredByAPaise: BigInt(data.declaredCashPaise),
                    carryOverPaise:   BigInt(data.carryOverPaise),
                    notes:            data.notes ?? null,
                },
            });
            await tx.posShift.update({
                where: { id: shiftId },
                data:  { status: "AWAITING_HANDOVER" },
            });
            return handover;
        });

        return NextResponse.json({
            id:              result.id,
            fromShiftId:     result.fromShiftId,
            toUserId:        result.toUserId,
            status:          result.status,
            declaredByAPaise: result.declaredByAPaise.toString(),
            carryOverPaise:  result.carryOverPaise.toString(),
            initiatedAt:     result.initiatedAt,
        }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to initiate handover");
    }
}

// ── DELETE — Cancel handover ─────────────────────────────────────────────────
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_CLOSE);
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const shift = await prisma.posShift.findUnique({
            where:  { id: shiftId },
            select: { id: true, status: true, userId: true },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status !== "AWAITING_HANDOVER") {
            return NextResponse.json({ error: "No pending handover on this shift" }, { status: 409 });
        }
        const canManage = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (shift.userId !== user!.id && !canManage) {
            return NextResponse.json({ error: "Not your shift" }, { status: 403 });
        }

        await prisma.$transaction(async (tx) => {
            await tx.posHandover.updateMany({
                where: { fromShiftId: shiftId, status: "PENDING" },
                data:  { status: "CANCELLED" },
            });
            await tx.posShift.update({
                where: { id: shiftId },
                data:  { status: "OPEN" },
            });
        });

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to cancel handover");
    }
}
