// Cancel a posted financial voucher (spine) inside a caller's transaction:
// reverse the cached Account.balance for every GL line and mark the spine
// CANCELLED. No counter-entry — the CANCELLED flag drops it from the truth path,
// so a reversing entry would double-reverse.
//
// Shared by the voucher cancel route and the POS shift reopen/delete routes,
// which have to void a shift's closing Contra / variance Journal atomically with
// the shift-row change.

import type { Prisma } from "@/generated/prisma/client";
import { balanceDelta, toNumber, loadNormalBalances } from "@/modules/accountancy/lib/balance";
import { ensureCancelable, cancelFields } from "@/modules/accountancy/lib/voucherLifecycle";

export async function cancelVoucherInTx(
    tx: Prisma.TransactionClient,
    voucherId: number,
    userId: number,
    reason: string,
): Promise<void> {
    const voucher = await tx.universalVoucher.findUnique({
        where:   { id: voucherId },
        include: { lines: true },
    });
    if (!voucher) return; // already hard-deleted — nothing left to void
    ensureCancelable(voucher);

    // Spine lines are scalar — resolve the reversal's nature exactly as the
    // engine resolved it when posting (group fallback included), or the
    // null-nature ledgers never get their delta taken back out.
    const nbById = await loadNormalBalances(tx, voucher.lines.map((l) => l.accountId));
    for (const line of voucher.lines) {
        const nb = nbById.get(line.accountId);
        if (!nb) continue;
        await tx.account.update({
            where: { id: line.accountId },
            data:  { balance: { decrement: balanceDelta(nb, line.type, toNumber(line.amount)) } },
        });
    }
    await tx.universalVoucher.update({ where: { id: voucher.id }, data: cancelFields(userId, reason) });
}
