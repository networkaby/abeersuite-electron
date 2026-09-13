// Restore (un-cancel) a cancelled financial voucher (spine) inside a caller's
// transaction: re-apply the cached Account.balance for every GL line and put the
// spine back to POSTED. The exact mirror of `cancelVoucherInTx` — cancel
// decremented each line's delta, so restore increments the same delta, resolving
// nature the same way (group fallback included) so null-nature ledgers are
// skipped on both sides and can never drift.

import type { Prisma } from "@/generated/prisma/client";
import { applyLineBalances } from "@/modules/accountancy/lib/balance";
import { ensureRestorable, restoreFields } from "@/modules/accountancy/lib/voucherLifecycle";

export async function restoreVoucherInTx(
    tx: Prisma.TransactionClient,
    voucherId: number,
): Promise<void> {
    const voucher = await tx.universalVoucher.findUnique({
        where:   { id: voucherId },
        include: { lines: true },
    });
    if (!voucher) return; // hard-deleted — nothing left to restore
    ensureRestorable(voucher);

    await applyLineBalances(tx, voucher.lines, "apply");
    await tx.universalVoucher.update({ where: { id: voucher.id }, data: restoreFields() });
}
