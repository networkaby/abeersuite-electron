// "Effective" balance helper — returns the CACHED balance (running cache in
// `Account.balance` + master opening), drift-prone if any post helper drops
// a delta.
//
// ⚠️  Do NOT use this in reporting / display surfaces.  All display paths
// (chart of accounts, group detail, account-groups list, GL account view,
// etc.) now read from `aggregateClosingAsOf` in aggregateLedger.ts, which
// re-derives closing from JournalLine and cannot drift.  See the kalu /
// Sundry Debtors incident in PROJECT_BRAIN / git history for the rationale.
//
// This helper is retained for **write-time quick reads** only — places that
// need a first-render hint of a party's current outstanding while a voucher
// is being composed, where slight staleness is acceptable because the user
// is about to post a new transaction anyway.  The post helpers themselves
// still maintain `Account.balance` via incremental deltas; this helper is
// the read side of that cache.

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
 * @deprecated Use `aggregateRolledUpByGroup` from `aggregateLedger.ts` for
 * any display surface — that variant derives the rollup from JournalLine and
 * cannot drift. This cache-path version is retained only for write-time
 * quick reads.
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
