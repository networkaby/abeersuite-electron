import type { Prisma } from "@/generated/prisma/client";

/**
 * Bump a shift's `updatedAt` after something happens on it.
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
 */
export async function touchPosShift(
    db: { posShift: Prisma.TransactionClient["posShift"] },
    shiftId: number,
): Promise<void> {
    await db.posShift.update({ where: { id: shiftId }, data: { updatedAt: new Date() } });
}
