// "Effective" balance helpers — the single source of truth for any UI or
// API that wants to display an account's true closing position.
//
// Why this exists: `Account.balance` only tracks deltas from posted vouchers.
// Opening balances live in separate columns (`openingBalance` +
// `openingBalanceType`). So any view that reads `Account.balance` directly
// (chart of accounts, group detail, account-groups list, …) under-reports
// opening-only ledgers (Cash, Bank, Capital seeded via opening-balance).
//
// These helpers fold in opening using the same `balanceDelta()` formula the
// Balance Sheet uses, so drilldowns reconcile with reports.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { balanceDelta, toNumber } from "./balance";

export type AccountForBalance = {
    balance:            { toString(): string } | number | null;
    normalBalance:      "DEBIT" | "CREDIT" | null;
    openingBalance:     { toString(): string } | number | null;
    openingBalanceType: "DEBIT" | "CREDIT" | null;
};

/** Required Prisma `select` shape for `effectiveLedgerBalance`. Pass to `findMany`/etc. */
export const EFFECTIVE_BALANCE_SELECT = {
    balance:            true,
    normalBalance:      true,
    openingBalance:     true,
    openingBalanceType: true,
} as const;

/**
 * Closing balance of a single account = transaction running total + opening
 * (sign-corrected to the account's normal side). Returns 0 when the account
 * has no normal balance and no opening — defensive default for orphan rows.
 */
export function effectiveLedgerBalance(a: AccountForBalance): number {
    const running = a.balance != null ? toNumber(a.balance) : 0;
    if (a.openingBalance == null || a.openingBalanceType == null || a.normalBalance == null) {
        return running;
    }
    const openingDelta = balanceDelta(
        a.normalBalance,
        a.openingBalanceType,
        toNumber(a.openingBalance),
    );
    return running + openingDelta;
}

/**
 * Bulk-load `Map<groupId, rolledUpEffectiveBalance>` for a set of group ids.
 * Walks descendants of each group, sums effective balances of every account
 * under them. Use when displaying a list of groups (account-groups tree,
 * group rollup columns, etc.) instead of repeated single calls.
 */
export async function loadGroupRolledUpBalances(
    groupIds: number[],
): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (groupIds.length === 0) return out;

    // Build the parent → children map once so we can walk descendant ids per group.
    const allGroups = await prisma.accountGroup.findMany({
        select: { id: true, parentId: true },
    });
    const childMap = new Map<number, number[]>();
    for (const g of allGroups) {
        if (g.parentId === null) continue;
        const arr = childMap.get(g.parentId) ?? [];
        arr.push(g.id);
        childMap.set(g.parentId, arr);
    }
    function descendantIds(rootId: number): number[] {
        const acc = [rootId];
        const stack = [rootId];
        while (stack.length) {
            const top = stack.pop()!;
            const kids = childMap.get(top) ?? [];
            acc.push(...kids);
            stack.push(...kids);
        }
        return acc;
    }

    // One query — get every account row with its effective-balance fields.
    // Avoids N+1 even for large charts (the chart of accounts is small enough
    // that a single bulk read is faster than per-group aggregates).
    const allAccounts = await prisma.account.findMany({
        select: { groupId: true, ...EFFECTIVE_BALANCE_SELECT },
    });

    // Index by groupId for fast lookup.
    const byGroup = new Map<number, AccountForBalance[]>();
    for (const a of allAccounts) {
        if (a.groupId == null) continue;
        const arr = byGroup.get(a.groupId) ?? [];
        arr.push(a);
        byGroup.set(a.groupId, arr);
    }

    for (const gid of groupIds) {
        const ids = descendantIds(gid);
        let sum = 0;
        for (const id of ids) {
            const accs = byGroup.get(id);
            if (!accs) continue;
            for (const a of accs) sum += effectiveLedgerBalance(a);
        }
        out.set(gid, sum);
    }
    return out;
}
