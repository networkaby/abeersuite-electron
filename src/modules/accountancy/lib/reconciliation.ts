// Reconciliation watermark — the rule that keeps `Account.reconciledThrough`
// honest when the books move underneath it.
//
// A reconciliation is a human assertion: "I matched this ledger against its
// outside statement up to 15-Oct." The assertion is made LATER than the date it
// covers — you sit down on 27-Dec and confirm through 15-Oct. `reconciledAt`
// records the sitting, `reconciledThrough` records how far it got.
//
// That gap is a hole. A voucher dated 13-Oct entered on 29-Dec lands INSIDE an
// already-certified window and quietly changes a balance you already signed off.
// Nothing about the flag itself notices — it still reads "through 15-Oct", now
// describing a ledger that no longer matches the statement.
//
// The fix: don't block the post (backdated entries are legitimate), and don't
// leave the flag lying. RETREAT it to the day before the dirty entry. 13-Oct
// dirty → the watermark drops to 12-Oct, so 13/14/15-Oct all fall back into
// unreconciled territory. 14 and 15 weren't touched individually, but they were
// certified as one block WITH the 13th, so the block needs re-confirming.

import type { Prisma } from "@/generated/prisma/client";
import { startOfDayUtc } from "@/shared/lib/format/formatDate";

/** The day before `date`, as a DATE-column-safe bound — the new watermark when
 *  `date` turns dirty. */
export function dayBeforeUtc(date: Date | string): Date {
    const start = startOfDayUtc(date);
    return new Date(start.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * Pull back the reconciliation watermark on every one of `accountIds` that had
 * been reconciled through `date` or later — the entry on `date` has dirtied it.
 *
 * One `updateMany` covers all of them: the new watermark depends only on the
 * voucher's date, not on where each ledger's watermark stood, and the `gte`
 * filter leaves ledgers reconciled only to an EARLIER date untouched.
 *
 * `reconciledAt` / `reconciledById` are deliberately NOT cleared or restamped.
 * They record when a human last reconciled and who — a retreat is the system
 * reacting, not a person asserting, and overwriting them would claim a
 * reconciliation happened that nobody performed.
 *
 * Call inside the same transaction as the GL write, so the watermark can never
 * be left describing a ledger state that got rolled back.
 */
export async function retreatReconciliation(
    tx: Prisma.TransactionClient,
    accountIds: number[],
    date: Date | string,
): Promise<void> {
    const ids = [...new Set(accountIds)];
    if (ids.length === 0) return;

    await tx.account.updateMany({
        where: {
            id:                { in: ids },
            reconciledThrough: { gte: startOfDayUtc(date) },
        },
        data: { reconciledThrough: dayBeforeUtc(date) },
    });
}
