import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * A came back before anybody took the drawer: the handover is dropped and the
 * shift is OPEN again, as if it had never been asked for. Nothing had posted, so
 * there is nothing to undo in the books. The row stays, CANCELLED — the next
 * handover on this shift reuses it (`fromShiftId` is unique).
 *
 * Safe to call on a shift that is not waiting: it changes nothing and says so.
 */
export async function cancelPendingHandover(db: Tx, shiftId: number): Promise<boolean> {
    const reopened = await db.posShift.updateMany({
        where: { id: shiftId, status: "AWAITING_HANDOVER" },
        data:  { status: "OPEN" },
    });
    await db.posHandover.updateMany({
        where: { fromShiftId: shiftId, status: "PENDING" },
        data:  { status: "CANCELLED" },
    });
    return reopened.count > 0;
}
