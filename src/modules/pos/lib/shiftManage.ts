// Shared guard for the shift reopen / delete routes.
//
// A closed shift's sweep and carry-over are what the NEXT shift on the same
// counter started from. Voiding those vouchers once a later shift exists would
// rewrite the till under that shift, so both routes refuse. Likewise a shift
// that ended by handover has its cash living on in the receiving shift.

import type { PrismaClient } from "@/generated/prisma/client";

export async function shiftManageBlock(
    db: PrismaClient,
    shift: { id: number; counterId: number; closedAt: Date | null; handoverToShiftId: number | null },
): Promise<string | null> {
    if (shift.handoverToShiftId != null) {
        return `This shift was handed over to shift #${shift.handoverToShiftId} and cannot be changed.`;
    }
    const later = await db.posShift.findFirst({
        where:   { counterId: shift.counterId, id: { gt: shift.id } },
        orderBy: { id: "asc" },
        select:  { id: true, status: true },
    });
    if (later) {
        return `Shift #${later.id} has already run on this counter after this one. Only the latest shift on a counter can be reopened or deleted.`;
    }
    return null;
}
