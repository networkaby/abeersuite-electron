// Cancel a posted financial voucher (spine) inside a caller's transaction:
// mark the spine CANCELLED. No counter-entry — the CANCELLED flag drops it from the truth path,
// so a reversing entry would double-reverse.
//
// Shared by the voucher cancel route and the POS shift reopen/delete routes,
// which have to void a shift's closing Contra / variance Journal atomically with
// the shift-row change.

import type { Prisma } from "@/generated/prisma/client";
import { retreatReconciliation } from "@/modules/accountancy/lib/reconciliation";
import { ensureCancelable, cancelFields, isCancelled, lockVoucher } from "@/modules/accountancy/lib/voucherLifecycle";

export async function cancelVoucherInTx(
    tx: Prisma.TransactionClient,
    voucherId: number,
    userId: number,
    reason: string,
    // Shift reopen/delete: a voucher someone already cancelled by hand from the
    // vouchers screen is exactly the state we want — skip it instead of refusing
    // the whole correction with "already cancelled".
    opts: { skipIfCancelled?: boolean } = {},
): Promise<void> {
    await lockVoucher(tx, voucherId);
    const voucher = await tx.universalVoucher.findUnique({
        where:   { id: voucherId },
        include: { lines: true },
    });
    if (!voucher) return; // already hard-deleted — nothing left to void
    if (opts.skipIfCancelled && isCancelled(voucher)) return;
    ensureCancelable(voucher);

    // Taking a voucher out of the books dirties a reconciled window exactly as much
    // as posting one — same retreat as the posting path. Idempotent, and the
    // watermark only ever travels backwards.
    await retreatReconciliation(tx, voucher.lines.map((l) => l.accountId), voucher.date);
    await tx.universalVoucher.update({ where: { id: voucher.id }, data: cancelFields(userId, reason) });
}
