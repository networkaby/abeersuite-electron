// POST /api/pos/shifts/[id]/handover
//
// A hands the whole drawer over: counts it on the close-shift screen and signs
// out. The shift goes AWAITING_HANDOVER and the handover row is PENDING with A's
// count and denominations. Nobody is named — whoever signs in next at this
// counter sees it (lock screen, then the takeover modal) and takes it over.
// NO GL movement here; everything posts on takeover (shifts/[id]/takeover).
//
// Body: { declaredCashPaise, denominations?, notes? }
//
// DELETE /api/pos/shifts/[id]/handover
// A came back before anybody took over — the shift is OPEN again, as if the
// handover had never been asked for.

import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handoverDenominationsSchema } from "@/modules/pos/lib/handoverDenominations";
import { cancelPendingHandover } from "@/modules/pos/lib/handover";

const initiateSchema = z.object({
    declaredCashPaise: z.number().int().min(0),
    denominations:     handoverDenominationsSchema.optional(),
    notes:             z.string().trim().max(500).optional(),
});

/** Thrown inside the transaction when the shift stopped being OPEN under us. */
class NotOpenError extends Error {}

// ── POST — Hand over ─────────────────────────────────────────────────────────
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_CLOSE);
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, initiateSchema);
    if (error) return error;

    try {
        const shift = await prismaWhereSaved().posShift.findUnique({
            where:  { id: shiftId },
            select: { id: true, status: true, userId: true },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

        const canManage = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (shift.userId !== user!.id && !canManage) {
            return NextResponse.json({ error: "Not your shift" }, { status: 403 });
        }

        const figures = {
            declaredByAPaise:  BigInt(data.declaredCashPaise),
            denominationsJson: data.denominations ?? Prisma.DbNull,
            notes:             data.notes || null,
            initiatedAt:       new Date(),
        };

        const result = await prisma.$transaction(async (tx) => {
            // The status check IS the write: two clicks, or a takeover landing at
            // the same moment, cannot both find the shift OPEN.
            const claimed = await tx.posShift.updateMany({
                where: { id: shiftId, status: "OPEN" },
                data:  { status: "AWAITING_HANDOVER" },
            });
            if (claimed.count !== 1) throw new NotOpenError();

            // One row per shift. A handover cancelled earlier (A came back) is
            // reused rather than created again — `fromShiftId` is unique.
            return tx.posHandover.upsert({
                where:  { fromShiftId: shiftId },
                create: { fromShiftId: shiftId, status: "PENDING", ...figures },
                update: { status: "PENDING", toUserId: null, acceptedAt: null, ...figures },
            });
        });

        return NextResponse.json({
            id:               result.id,
            fromShiftId:      result.fromShiftId,
            status:           result.status,
            declaredByAPaise: result.declaredByAPaise?.toString() ?? null,
            initiatedAt:      result.initiatedAt,
        }, { status: 201 });
    } catch (e) {
        if (e instanceof NotOpenError) {
            return NextResponse.json({ error: "This shift is no longer open, so it cannot be handed over." }, { status: 409 });
        }
        return handleApiError(e, "Failed to hand over");
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
        const shift = await prismaWhereSaved().posShift.findUnique({
            where:  { id: shiftId },
            select: { id: true, status: true, userId: true },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        const canManage = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (shift.userId !== user!.id && !canManage) {
            return NextResponse.json({ error: "Not your shift" }, { status: 403 });
        }

        const reopened = await prisma.$transaction((tx) => cancelPendingHandover(tx, shiftId));
        if (!reopened) return NextResponse.json({ error: "No pending handover on this shift" }, { status: 409 });

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to cancel handover");
    }
}
