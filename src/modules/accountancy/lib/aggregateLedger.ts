// Single-pass aggregation of POSTED VoucherGlLines (universal-voucher spine) per account.
// Returns opening / debits / credits / closing — given a date range (or just an asOf for closing-only).

import type { Prisma, VoucherStatus } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { FINANCE_BAR_POLL_MS } from "@/shared/lib/constants/polling";
import { balanceDelta, toNumber } from "./balance";
import { computeTradingStockAdjustment } from "./tradingStockAdjustment";

export type LedgerMode = "posted" | "provisional";

/**
 * The single ledger-inclusion gate for universal-voucher reads. `posted`
 * (default) = POSTED only (the books); `provisional` also includes DRAFT
 * (Tally-Scenario what-if). CANCELLED / soft-deleted are never counted. Every GL
 * reader — Balance Sheet, P&L, Trial Balance, Day Book, ledger, cash-flow,
 * recompute-balances, till-ledger — spreads this into its `universalVoucher`
 * filter so they agree by construction.
 */
export function ledgerStatusFilterUv(mode: LedgerMode = "posted"): Prisma.UniversalVoucherWhereInput {
    return mode === "provisional"
        ? { status: { in: ["POSTED", "DRAFT"] as VoucherStatus[] }, deletedAt: null }
        : { status: "POSTED" as VoucherStatus, deletedAt: null };
}

export type AccountAggregate = {
    accountId: number;
    opening:   number;
    debits:    number;
    credits:   number;
    closing:   number;
};

/** Map (accountId → "DEBIT" | "CREDIT") with fallback inferred from group type. */
export async function loadNormalBalanceMap(): Promise<Map<number, "DEBIT" | "CREDIT">> {
    const accounts = await prisma.account.findMany({
        select: {
            id: true,
            normalBalance: true,
            group: { select: { type: true } },
        },
    });
    const map = new Map<number, "DEBIT" | "CREDIT">();
    for (const a of accounts) {
        if (a.normalBalance) {
            map.set(a.id, a.normalBalance);
            continue;
        }
        // Fallback: infer from group.type
        const g = a.group?.type;
        if (g === "ASSET" || g === "EXPENSE") map.set(a.id, "DEBIT");
        else if (g) map.set(a.id, "CREDIT");
    }
    return map;
}

/**
 * Recompute the cached `Account.balance` for the given accounts straight from the
 * GL truth (Σ posted `VoucherGlLine` deltas) — the GL parallel of
 * `recomputeProductStock`. Policy: create updates the cache incrementally; an
 * EDIT rewrites the ledger then calls this, so the cache rebuilds from truth with
 * no fragile reverse/reapply math. NB: `Account.balance` is movement-only — the
 * master `openingBalance` is folded in at read time by `aggregateClosingAsOf`,
 * NOT stored in the cache (unlike stock's `openingStock`), so it's excluded here.
 */
export async function recomputeAccountBalances(
    tx: Prisma.TransactionClient,
    accountIds: number[],
): Promise<void> {
    const ids = [...new Set(accountIds)];
    if (ids.length === 0) return;

    const [sums, accounts] = await Promise.all([
        tx.voucherGlLine.groupBy({
            by:    ["accountId", "type"],
            where: { accountId: { in: ids }, universalVoucher: { ...ledgerStatusFilterUv() } },
            _sum:  { amount: true },
        }),
        tx.account.findMany({
            where:  { id: { in: ids } },
            select: { id: true, normalBalance: true, group: { select: { type: true } } },
        }),
    ]);

    const nb = new Map<number, "DEBIT" | "CREDIT">();
    for (const a of accounts) {
        if (a.normalBalance) { nb.set(a.id, a.normalBalance); continue; }
        const g = a.group?.type;
        if (g === "ASSET" || g === "EXPENSE") nb.set(a.id, "DEBIT");
        else if (g) nb.set(a.id, "CREDIT");
    }

    const computed = new Map<number, number>();
    for (const r of sums) {
        const side = nb.get(r.accountId);
        if (!side) continue;
        computed.set(r.accountId, (computed.get(r.accountId) ?? 0) + balanceDelta(side, r.type, Number(r._sum.amount ?? 0)));
    }

    for (const id of ids) {
        await tx.account.update({ where: { id }, data: { balance: computed.get(id) ?? 0 } });
    }
}

/** Pull master-page opening balances (Account.openingBalance / openingBalanceType / openingBalanceDate).
 *  Returns Map<accountId, signedOpening> already converted into normal-balance terms (positive
 *  when on the account's normal side). Only accounts whose openingBalanceDate is null or
 *  <= the given as-of date are included. */
export async function loadMasterOpeningBalances(
    asOf: Date,
    nbMap: Map<number, "DEBIT" | "CREDIT">,
): Promise<Map<number, number>> {
    const accounts = await prisma.account.findMany({
        where: { openingBalance: { not: null } },
        select: { id: true, openingBalance: true, openingBalanceType: true, openingBalanceDate: true },
    });
    const out = new Map<number, number>();
    for (const a of accounts) {
        if (a.openingBalanceDate && a.openingBalanceDate > asOf) continue;
        const nb = nbMap.get(a.id);
        if (!nb || !a.openingBalanceType) continue;
        // Treat the opening figure as a single signed entry on the recorded side.
        out.set(a.id, balanceDelta(nb, a.openingBalanceType, Number(a.openingBalance ?? 0)));
    }
    return out;
}

/**
 * "Can the caller keep the figures it already has?" — the server half of the
 * poll-and-skip pattern the finance top bar uses (see `shared/lib/browser/pollCache`).
 *
 * `sinceParam` is the `computedAt` the client got on its last fetch. True means
 * nothing has happened that could move a balance, so the route can skip the whole
 * aggregation and answer `{ unchanged: true }`.
 *
 * Two deliberate rules:
 *   • No status filter on the lookup — an edit or a cancellation bumps `updatedAt`
 *     just like a new posting, and any of the three can change a closing balance.
 *   • Only honoured within one poll interval. Balances are read "as of end of
 *     today", so the answer can also change with nothing written at all: a
 *     future-dated voucher becomes current, or the business day rolls over at
 *     midnight. Capping the trust window keeps that bounded to one tick instead
 *     of a figure that silently never refreshes.
 */
export async function isUnchangedSince(sinceParam: string | null, now: Date): Promise<boolean> {
    if (!sinceParam) return false;
    const since = new Date(sinceParam);
    if (Number.isNaN(since.getTime())) return false;
    if (now.getTime() - since.getTime() >= FINANCE_BAR_POLL_MS) return false;

    const row = await prisma.universalVoucher.findFirst({
        where: { updatedAt: { gt: since } },
        select: { id: true },
    });
    return row === null;
}

/** Closing balances of every account as of a date.  Map<accountId, closing> in rupees. */
export async function aggregateClosingAsOf(
    asOf: Date,
    nbMap: Map<number, "DEBIT" | "CREDIT">,
): Promise<Map<number, number>> {
    const [sums, masterOpening] = await Promise.all([
        prisma.voucherGlLine.groupBy({
            by: ["accountId", "type"],
            _sum: { amount: true },
            where: { universalVoucher: { ...ledgerStatusFilterUv(), date: { lte: asOf } } },
        }),
        loadMasterOpeningBalances(asOf, nbMap),
    ]);
    const buckets = new Map<number, { d: number; c: number }>();
    for (const r of sums) {
        const v = buckets.get(r.accountId) ?? { d: 0, c: 0 };
        const amt = Number(r._sum.amount ?? 0);
        if (r.type === "DEBIT") v.d += amt;
        else                    v.c += amt;
        buckets.set(r.accountId, v);
    }
    const closing = new Map<number, number>();
    for (const [accId, v] of buckets) {
        const nb = nbMap.get(accId);
        if (!nb) continue;
        const fromLines = nb === "DEBIT" ? v.d - v.c : v.c - v.d;
        closing.set(accId, fromLines + (masterOpening.get(accId) ?? 0));
    }
    // Accounts that have a master opening but no journal lines yet still need to appear.
    for (const [accId, openVal] of masterOpening) {
        if (!closing.has(accId)) closing.set(accId, openVal);
    }
    return closing;
}

/**
 * Same shape as `aggregateClosingAsOf`, but built from the running
 * `Account.balance` cache instead of re-summing every GL line ever posted.
 *
 * Why this is safe: `Account.balance` is maintained incrementally by the ONE GL
 * writer (`engineGlArm` / `enginePostSpine`) inside the posting's own
 * transaction; a trading edit rebuilds via `recomputeAccountBalances`, and the
 * cancel / hard-delete routes reverse their own deltas. So a create costs a
 * per-line increment and a removal costs a per-line decrement — neither ever
 * needs a whole-ledger scan.
 *
 * That symmetry is the whole invariant, and it is load-bearing: post and
 * reverse must resolve an account's Dr/Cr nature identically. Both sides go
 * through `loadNormalBalances` (`normalBalance` ?? group fallback) for exactly
 * that reason — see the note there for the drift this cost us before. The
 * `recompute-balances` maintenance route stays the periodic drift check.
 *
 * Three corrections turn the cache into a true "closing as of a date":
 *   • `Account.balance` is movement-only — the master `openingBalance` is folded
 *     in at read time, exactly as `aggregateClosingAsOf` does.
 *   • `Account.balance` counts every POSTED line whatever its date, but closing
 *     means `date <= asOf`. Future-dated postings are subtracted back out. That
 *     query is indexed on `date` and normally matches nothing.
 *   • Accounts with neither movement nor a master opening are left out, so
 *     callers that list sub-ledgers don't sprout empty ₹0 rows.
 *
 * Use for the poll-driven top-bar surfaces. Reports that must be
 * provably-from-truth should keep calling `aggregateClosingAsOf`.
 */
export async function closingFromCache(
    asOf: Date,
    nbMap: Map<number, "DEBIT" | "CREDIT">,
): Promise<Map<number, number>> {
    const [accounts, futureSums, masterOpening] = await Promise.all([
        prisma.account.findMany({ select: { id: true, balance: true } }),
        prisma.voucherGlLine.groupBy({
            by: ["accountId", "type"],
            _sum: { amount: true },
            where: { universalVoucher: { ...ledgerStatusFilterUv(), date: { gt: asOf } } },
        }),
        loadMasterOpeningBalances(asOf, nbMap),
    ]);

    const closing = new Map<number, number>();
    for (const a of accounts) {
        if (!nbMap.has(a.id)) continue;
        const running = toNumber(a.balance ?? 0);
        if (running !== 0) closing.set(a.id, running);
    }
    // Undo anything dated after `asOf` — it is in the running cache but is not
    // part of today's closing.
    for (const r of futureSums) {
        const nb = nbMap.get(r.accountId);
        if (!nb) continue;
        const back = balanceDelta(nb, r.type, toNumber(r._sum.amount ?? 0));
        closing.set(r.accountId, (closing.get(r.accountId) ?? 0) - back);
    }
    for (const [accId, openVal] of masterOpening) {
        closing.set(accId, (closing.get(accId) ?? 0) + openVal);
    }
    return closing;
}

/** Roll-up `aggregateClosingAsOf` by group — returns Map<groupId, rolledUpClosing>.
 *  Walks each requested group's descendants, sums the truth-path closing of
 *  every account under them. Use this for any display surface that needs a
 *  group's total balance — it agrees with the Balance Sheet by construction
 *  because both go through `aggregateClosingAsOf`.
 *
 *  Replaces the cache-path `loadGroupRolledUpBalances` (which read the
 *  drift-prone `Account.balance` column). */
export async function aggregateRolledUpByGroup(
    groupIds: number[],
    asOf: Date = new Date(),
): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (groupIds.length === 0) return out;

    const [allGroups, allAccounts, nbMap] = await Promise.all([
        prisma.accountGroup.findMany({ select: { id: true, parentId: true } }),
        prisma.account.findMany({ select: { id: true, groupId: true } }),
        loadNormalBalanceMap(),
    ]);
    const closingMap = await aggregateClosingAsOf(asOf, nbMap);

    const childMap = new Map<number, number[]>();
    for (const g of allGroups) {
        if (g.parentId === null) continue;
        const arr = childMap.get(g.parentId) ?? [];
        arr.push(g.id);
        childMap.set(g.parentId, arr);
    }
    const descendantIds = (rootId: number): number[] => {
        const acc = [rootId];
        const stack = [rootId];
        while (stack.length) {
            const top = stack.pop()!;
            const kids = childMap.get(top) ?? [];
            acc.push(...kids);
            stack.push(...kids);
        }
        return acc;
    };

    // Index accounts by groupId for O(1) lookup per descendant.
    const byGroup = new Map<number, number[]>();
    for (const a of allAccounts) {
        if (a.groupId == null) continue;
        const arr = byGroup.get(a.groupId) ?? [];
        arr.push(a.id);
        byGroup.set(a.groupId, arr);
    }

    for (const gid of groupIds) {
        let sum = 0;
        for (const id of descendantIds(gid)) {
            const accIds = byGroup.get(id);
            if (!accIds) continue;
            for (const accId of accIds) sum += closingMap.get(accId) ?? 0;
        }
        out.set(gid, sum);
    }
    return out;
}

/** Opening + transactions + closing per account over a date range.
 *
 * Master-page opening balances (Account.openingBalance) are one-sided —
 * they live on the master record, not in a balanced JE. They are folded
 * into the opening bucket whenever their `openingBalanceDate` is <= `to`
 * (regardless of whether it falls inside or before the period). That
 * keeps the Trial Balance balanced (Dr-from-JEs always equals Cr-from-JEs)
 * while still surfacing the master opening on every downstream report
 * via the `closing = opening + period-Δ` rollup.
 *
 *   • dated <= to → folded into the opening bucket (carry-forward into the period).
 *   • dated > to  → ignored entirely.
 */
export async function aggregateRange(
    from: Date,
    to: Date,
    nbMap: Map<number, "DEBIT" | "CREDIT">,
): Promise<Map<number, AccountAggregate>> {
    const [openingSums, periodSums, masterOpening] = await Promise.all([
        prisma.voucherGlLine.groupBy({
            by: ["accountId", "type"],
            _sum: { amount: true },
            where: { universalVoucher: { ...ledgerStatusFilterUv(), date: { lt: from } } },
        }),
        prisma.voucherGlLine.groupBy({
            by: ["accountId", "type"],
            _sum: { amount: true },
            where: { universalVoucher: { ...ledgerStatusFilterUv(), date: { gte: from, lte: to } } },
        }),
        loadMasterOpeningBalances(to, nbMap),
    ]);

    const result = new Map<number, AccountAggregate>();
    const ensure = (id: number): AccountAggregate => {
        let v = result.get(id);
        if (!v) {
            v = { accountId: id, opening: 0, debits: 0, credits: 0, closing: 0 };
            result.set(id, v);
        }
        return v;
    };

    for (const r of openingSums) {
        const nb = nbMap.get(r.accountId);
        if (!nb) continue;
        const v = ensure(r.accountId);
        v.opening += balanceDelta(nb, r.type, Number(r._sum.amount ?? 0));
    }
    // Master openings dated on or before `to` → opening bucket. One-sided by
    // nature, so they must NOT enter the period debits / credits columns —
    // otherwise the Trial Balance's Dr column ≠ Cr column.
    for (const [accId, openVal] of masterOpening) {
        const v = ensure(accId);
        v.opening += openVal;
    }
    for (const r of periodSums) {
        const v = ensure(r.accountId);
        const amt = Number(r._sum.amount ?? 0);
        if (r.type === "DEBIT") v.debits  += amt;
        else                    v.credits += amt;
    }
    for (const v of result.values()) {
        const nb = nbMap.get(v.accountId);
        if (!nb) continue;
        v.closing = v.opening + (nb === "DEBIT" ? v.debits - v.credits : v.credits - v.debits);
    }
    return result;
}

/** Net Profit/Loss for a range, trading-account aware.
 *  Positive = profit, negative = loss.
 *
 *  Mirrors the P&L route's calculation by adding the
 *  (closingStock − openingStock) trading adjustment to the JE-only
 *  income/expense delta. Without this adjustment the Balance Sheet's
 *  Equity total would drift away from the P&L's net profit whenever
 *  inventory levels change during the period.
 */
export async function netProfitLoss(from: Date, to: Date): Promise<number> {
    const groups = await prisma.accountGroup.findMany({
        where: { type: { in: ["INCOME", "EXPENSE"] } },
        select: { id: true, type: true },
    });
    const incomeGroupIds  = groups.filter((g) => g.type === "INCOME").map((g) => g.id);
    const expenseGroupIds = groups.filter((g) => g.type === "EXPENSE").map((g) => g.id);

    const [incomeAccounts, expenseAccounts] = await Promise.all([
        prisma.account.findMany({ where: { groupId: { in: incomeGroupIds } },  select: { id: true } }),
        prisma.account.findMany({ where: { groupId: { in: expenseGroupIds } }, select: { id: true } }),
    ]);
    const incomeIds  = incomeAccounts.map((a)  => a.id);
    const expenseIds = expenseAccounts.map((a) => a.id);

    // Master-page openings dated within [from, to] count as period activity
    // (mirrors the same fix in aggregateRange so this stays in sync with the
    // P&L route's net-profit figure).
    const masterInPeriod = await prisma.account.findMany({
        where: {
            openingBalance: { not: null },
            openingBalanceDate: { gte: from, lte: to },
            groupId: { in: [...incomeGroupIds, ...expenseGroupIds] },
        },
        select: { id: true, openingBalance: true, openingBalanceType: true, groupId: true },
    });
    const incomeIdSet  = new Set(incomeIds);

    const sumNetCredit = async (ids: number[]): Promise<number> => {
        if (ids.length === 0) return 0;
        const sums = await prisma.voucherGlLine.groupBy({
            by: ["type"],
            _sum: { amount: true },
            where: {
                accountId: { in: ids },
                universalVoucher: { ...ledgerStatusFilterUv(), date: { gte: from, lte: to } },
            },
        });
        let dr = 0, cr = 0;
        for (const s of sums) {
            const amt = Number(s._sum.amount ?? 0);
            if (s.type === "DEBIT") dr += amt;
            else                    cr += amt;
        }
        // Add in-period master openings on income accounts (positive when income).
        for (const a of masterInPeriod) {
            if (!incomeIdSet.has(a.id) || !a.openingBalanceType) continue;
            const amt = Number(a.openingBalance ?? 0);
            if (a.openingBalanceType === "DEBIT") dr += amt;
            else                                  cr += amt;
        }
        return cr - dr;
    };
    const sumNetDebit = async (ids: number[]): Promise<number> => {
        if (ids.length === 0) return 0;
        const sums = await prisma.voucherGlLine.groupBy({
            by: ["type"],
            _sum: { amount: true },
            where: {
                accountId: { in: ids },
                universalVoucher: { ...ledgerStatusFilterUv(), date: { gte: from, lte: to } },
            },
        });
        let dr = 0, cr = 0;
        for (const s of sums) {
            const amt = Number(s._sum.amount ?? 0);
            if (s.type === "DEBIT") dr += amt;
            else                    cr += amt;
        }
        // Add in-period master openings on expense accounts (positive when expense).
        const expenseIdSet = new Set(ids);
        for (const a of masterInPeriod) {
            if (!expenseIdSet.has(a.id) || !a.openingBalanceType) continue;
            const amt = Number(a.openingBalance ?? 0);
            if (a.openingBalanceType === "DEBIT") dr += amt;
            else                                  cr += amt;
        }
        return dr - cr;
    };

    const income  = await sumNetCredit(incomeIds);
    const expense = await sumNetDebit(expenseIds);
    const stock   = await computeTradingStockAdjustment(from, to);
    return (income - expense) + stock.adjustment;
}
