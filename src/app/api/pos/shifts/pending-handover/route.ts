// GET /api/pos/shifts/pending-handover
//
// Returns a PENDING PosHandover where the current user is the intended
// recipient (toUserId) and the from-shift's counter is in the active branch.
// Called by PosScreen on mount when /current returns null — if a handover
// is found, show HandoverAcceptDialog instead of ShiftOpenDialog.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const handover = await prisma.posHandover.findFirst({
            where: {
                toUserId: user!.id,
                status:   "PENDING",
                // No branchId filter — B's active-branch cookie may differ from the counter's branch.
            },
            include: {
                fromShift: {
                    include: {
                        user:    { select: { id: true, name: true } },
                        counter: { include: { tillAccount: { select: { id: true, name: true, balance: true } } } },
                        branch:  { select: { id: true, name: true } },
                    },
                },
            },
        });

        if (!handover) return NextResponse.json(null);

        return NextResponse.json({
            id:              handover.id,
            status:          handover.status,
            declaredByAPaise: handover.declaredByAPaise.toString(),
            carryOverPaise:  handover.carryOverPaise.toString(),
            notes:           handover.notes,
            initiatedAt:     handover.initiatedAt,
            fromShift: {
                id:      handover.fromShift.id,
                user:    handover.fromShift.user,
                counter: {
                    id:   handover.fromShift.counter.id,
                    name: handover.fromShift.counter.name,
                    tillAccount: {
                        id:      handover.fromShift.counter.tillAccount.id,
                        name:    handover.fromShift.counter.tillAccount.name,
                        balance: handover.fromShift.counter.tillAccount.balance.toString(),
                    },
                },
                branch: handover.fromShift.branch,
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch pending handover");
    }
}
