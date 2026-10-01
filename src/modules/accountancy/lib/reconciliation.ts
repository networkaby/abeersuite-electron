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

// ── What dirties a window, and how far ───────────────────────────────────────
//
// The owner's rules (2026-10-01):
//   • a voucher edit pulls the lock back only on a ledger whose amounts in that
//     voucher changed — or on every ledger in it when the date moved, since the
//     amount then leaves one day for another;
//   • a change to a ledger's opening balance, and a merge into it, clear its
//     lock outright — they reach every day the ledger has.

type Leg = { accountId: number; type: "DEBIT" | "CREDIT"; amount: unknown };

/** One ledger's legs in a voucher, as a comparable signature. */
function legSignature(legs: Leg[], accountId: number): string {
    return legs
        .filter((l) => l.accountId === accountId)
        .map((l) => ((l.type === "DEBIT" ? 1 : -1) * Number(l.amount)).toFixed(2))
        .sort()
        .join("|");
}

/**
 * The ledgers a voucher edit actually changed: a different set of amounts on
 * the ledger, or — when the date moved — every ledger the voucher touches,
 * before or after.
 */
export function changedLedgers(before: Leg[], after: Leg[], dateMoved: boolean): number[] {
    const ids = [...new Set([...before, ...after].map((l) => l.accountId))];
    return dateMoved ? ids : ids.filter((id) => legSignature(before, id) !== legSignature(after, id));
}

/** Clear the lock outright on every one of `accountIds` that has one. */
export async function resetReconciliation(tx: Prisma.TransactionClient, accountIds: number[]): Promise<void> {
    const ids = [...new Set(accountIds)];
    if (ids.length === 0) return;
    await tx.account.updateMany({
        where: { id: { in: ids }, reconciledThrough: { not: null } },
        data:  { reconciledThrough: null },
    });
}

function signedOpening(amount: unknown, type: string | null | undefined): number {
    if (amount == null || type == null) return 0;
    const n = Number(amount);
    return type === "DEBIT" ? n : -n;
}

/**
 * Call BEFORE writing a ledger's opening balance: clears its lock when the
 * figure is really changing. `undefined` = that half is not being written.
 * Outside a transaction, a write that then fails has merely cleared the lock
 * early — the safe side.
 */
export async function resetReconciliationOnOpening(
    tx: Prisma.TransactionClient,
    accountId: number,
    next: { amount?: number | null; type?: "DEBIT" | "CREDIT" | null },
): Promise<void> {
    const cur = await tx.account.findUnique({
        where:  { id: accountId },
        select: { openingBalance: true, openingBalanceType: true, reconciledThrough: true },
    });
    if (!cur || cur.reconciledThrough == null) return;
    const amount = next.amount === undefined ? cur.openingBalance : next.amount;
    const type = next.type === undefined ? cur.openingBalanceType : next.type;
    if (Math.abs(signedOpening(cur.openingBalance, cur.openingBalanceType) - signedOpening(amount, type)) >= 0.005) {
        await resetReconciliation(tx, [accountId]);
    }
}

/**
 * Keep bank ticks across a voucher's line rewrite. The edit paths delete and
 * re-create a voucher's GL lines, minting fresh ids, and a tick
 * (BankStatementMatch) points at the old id — so without this every edit, even
 * one that changes nothing on the bank, leaves the tick stale; and on a
 * statement line before the lock, stale for good. Each ticked old line is
 * re-pointed at the new line with the same ledger, side and amount. One that
 * no longer has a twin stays stale — its amount changed, so the lock has moved
 * back and the line can be ticked again.
 */
export async function carryStatementMatches(
    tx: Prisma.TransactionClient,
    universalVoucherId: number,
    before: Array<Leg & { id: number }>,
): Promise<void> {
    if (before.length === 0) return;
    const ticked = new Set((await tx.bankStatementMatch.findMany({
        where:  { glLineId: { in: before.map((l) => l.id) } },
        select: { glLineId: true },
    })).map((m) => m.glLineId));
    if (ticked.size === 0) return;
    const fresh = await tx.voucherGlLine.findMany({
        where:  { universalVoucherId },
        select: { id: true, accountId: true, type: true, amount: true },
    });
    const claimed = new Set<number>();
    for (const old of before) {
        if (!ticked.has(old.id)) continue;
        const twin = fresh.find((n) => !claimed.has(n.id)
            && n.accountId === old.accountId && n.type === old.type
            && Math.abs(Number(n.amount) - Number(old.amount)) < 0.005);
        if (!twin) continue;
        claimed.add(twin.id);
        await tx.bankStatementMatch.updateMany({ where: { glLineId: old.id }, data: { glLineId: twin.id } });
    }
}
