import type { Prisma } from "@/generated/prisma/client";

/**
 * Phase 5 5C dual-write: stamp `universalVoucherId` on a voucher's goods lines
 * (VoucherInventoryLine) and stock-ledger rows (InvStockLedger) from its spine id,
 * so those children re-home onto the spine. Idempotent — only fills nulls, so it's
 * safe to call at BOTH create (links the goods lines; stock not written yet) and
 * post (links the just-written stock rows; lines already linked). Keeps `voucherId`
 * in step until it's dropped (5C-3).
 */
export async function linkVoucherChildrenToSpine(
    tx: Prisma.TransactionClient,
    invVoucherId: number,
    spineId: number | null | undefined,
): Promise<void> {
    if (spineId == null) return;
    await tx.voucherInventoryLine.updateMany({
        where: { voucherId: invVoucherId, universalVoucherId: null },
        data:  { universalVoucherId: spineId },
    });
    await tx.invStockLedger.updateMany({
        where: { voucherId: invVoucherId, universalVoucherId: null },
        data:  { universalVoucherId: spineId },
    });
}
