// Restore (un-cancel) a cancelled financial voucher (spine) inside a caller's
// transaction: put the spine back to POSTED. The exact mirror of
// `cancelVoucherInTx`.

import type { Prisma } from "@/generated/prisma/client";
import { retreatReconciliation } from "@/modules/accountancy/lib/reconciliation";
import { ensureRestorable, restoreFields, lockVoucher } from "@/modules/accountancy/lib/voucherLifecycle";

export async function restoreVoucherInTx(
    tx: Prisma.TransactionClient,
    voucherId: number,
): Promise<void> {
    await lockVoucher(tx, voucherId);
    const voucher = await tx.universalVoucher.findUnique({
        where:   { id: voucherId },
        include: { lines: true },
    });
    if (!voucher) return; // hard-deleted — nothing left to restore
    ensureRestorable(voucher);

    // Putting a voucher back into the books dirties a reconciled window exactly as much
    // as posting one — same retreat as the posting path. Idempotent, and the
    // watermark only ever travels backwards.
    await retreatReconciliation(tx, voucher.lines.map((l) => l.accountId), voucher.date);
    await tx.universalVoucher.update({ where: { id: voucher.id }, data: restoreFields() });
}
