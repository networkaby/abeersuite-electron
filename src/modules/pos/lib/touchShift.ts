import type { Prisma } from "@/generated/prisma/client";

/** Another press closed (or handed over) the shift between the check and the save. */
export class ShiftNotOpenError extends Error {}

/**
 * Bump an OPEN shift's `updatedAt` after something happens on it.
 *
 * `PosCashDrop` is a `child` table in `prisma/sync-tables.json`: the sync worker
 * pulls a shift's children only in a cycle where the shift row itself moved. A drop
 * recorded against an untouched shift therefore reached another machine's replica
 * only on the hourly reconcile sweep — and, on a `WRITE_MODE=v_live` till, not even
 * the till's own replica, because the write happened at the office. Touching the
 * parent in the same transaction makes the child ride the very next pull, targeted
 * or not.
 *
 * Receipts and expenditures no longer need this to replicate — they are vouchers
 * now (`UniversalVoucher.sourceShiftId`) and travel on their own watermark. The
 * money routes still call it so the shift's own row reads as freshly active.
 *
 * It is also the save's shift check: the status test and the write are one
 * statement, so a shift closed since the route looked refuses the whole save. Call
 * it FIRST in the transaction — it holds the shift row until commit, as shift close
 * does, and every money route taking that row before the ledger and number rows is
 * what keeps two of them from deadlocking.
 */
export async function touchPosShift(
    db: { posShift: Prisma.TransactionClient["posShift"] },
    shiftId: number,
): Promise<void> {
    const { count } = await db.posShift.updateMany({
        where: { id: shiftId, status: "OPEN" },
        data:  { updatedAt: new Date() },
    });
    if (count !== 1) throw new ShiftNotOpenError();
}
