// Single-pass aggregation of POSTED VoucherGlLines (universal-voucher spine) per account.
// Returns opening / debits / credits / closing — given a date range (or just an asOf for closing-only).

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { FINANCE_BAR_POLL_MS } from "@/shared/lib/constants/polling";
import { balanceDelta } from "./balance";
import { computeTradingStockAdjustment } from "./tradingStockAdjustment";
import { parseSince } from "@/shared/lib/prisma/counterMode";
import { ledgerStatusFilterUv } from "./ledgerStatus";
import { OPENING_TYPE } from "./openingBills";

// Both live in `./ledgerStatus` now, so a caller needing only the gate does not
// have to pull this module's `server-only` dependency chain in. Re-exported here
// so every existing importer is untouched.
export { ledgerStatusFilterUv } from "./ledgerStatus";
export type { LedgerMode } from "./ledgerStatus";

/**
 * Anything that can run these reads: the module client, or an open transaction.
 * Threaded through the narrowed helpers so a gate that must see its own
 * in-flight writes (`checkCreditLimit`, inside the sale's tx) reads the ledger
 * on the same connection instead of settling for a cached column.
 */
export type LedgerReadClient = Prisma.TransactionClient;

export type AccountAggregate = {
    accountId: number;
    opening:   number;
    debits:    number;
    credits:   number;
    closing:   number;
};

/**
 * Map (accountId → "DEBIT" | "CREDIT") with fallback inferred from group type.
 * `accountIds` narrows it to the accounts the caller needs; omit for all.
 */
export async function loadNormalBalanceMap(
    accountIds?: number[],
    db: LedgerReadClient = prisma,
): Promise<Map<number, "DEBIT" | "CREDIT">> {
    if (accountIds && accountIds.length === 0) return new Map();
    const accounts = await db.account.findMany({
        ...(accountIds ? { where: { id: { in: accountIds } } } : {}),
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
        // Fallback: infer from group.type. A ledger with neither is read as
        // Dr — the posting engine's and the party Transactions tab's default —
        // never dropped: a skipped account showed its money as Nil everywhere.
        const g = a.group?.type;
        map.set(a.id, g && g !== "ASSET" && g !== "EXPENSE" ? "CREDIT" : "DEBIT");
    }
    return map;
}

/**
 * The one rule for every opening — a master figure or an opening bill alike:
 * it is the position BEFORE the books begin, so it counts on every date, as the
 * opening, whatever date it carries. 1 April already has transactions, so the
 * only place the real opening can be read is the 31 March closing — and that
 * closing must therefore hold every opening (owner, 2026-10-14). An opening
 * bill's date is for ageing and the bill list, never for which balance it
 * belongs to.
 *
 * As a `universalVoucher` filter: "dated on or before `asOf`, or an opening".
 */
function onOrBeforeOrOpening(asOf: Date): Prisma.UniversalVoucherWhereInput {
    return { OR: [{ date: { lte: asOf } }, { type: OPENING_TYPE }] };
}

/** Pull master-page opening balances (Account.openingBalance / openingBalanceType).
 *  Returns Map<accountId, signedOpening> already converted into normal-balance terms (positive
 *  when on the account's normal side). Every one counts, whatever its
 *  `openingBalanceDate` — see `onOrBeforeOrOpening`. */
export async function loadMasterOpeningBalances(
    nbMap: Map<number, "DEBIT" | "CREDIT">,
    accountIds?: number[],
    db: LedgerReadClient = prisma,
): Promise<Map<number, number>> {
    const accounts = await db.account.findMany({
        where: {
            openingBalance: { not: null },
            ...(accountIds ? { id: { in: accountIds } } : {}),
        },
        select: { id: true, openingBalance: true, openingBalanceType: true },
    });
    const out = new Map<number, number>();
    for (const a of accounts) {
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
export async function isUnchangedSince(
    sinceParam: string | null,
    now: Date,
    /** The trust window — the top bar's poll by default; the phone passes its own. */
    maxAgeMs: number = FINANCE_BAR_POLL_MS,
): Promise<boolean> {
    const since = parseSince(sinceParam);
    if (!since) return false;
    if (now.getTime() - since.getTime() >= maxAgeMs) return false;

    const row = await prisma.universalVoucher.findFirst({
        where: { updatedAt: { gt: since } },
        select: { id: true },
    });
    return row === null;
}

/**
 * Closing balances as of a date, summed from the GL lines themselves.
 * Map<accountId, closing> in rupees. This is the truth read.
 *
 * `accountIds` narrows the scan to the accounts the caller actually shows. Pass
 * it whenever the caller knows its set — a paginated party list, a credit-limit
 * check, a till's own accounts. With a local replica that turns the truth read
 * into an indexed lookup over a handful of accounts, which is why those surfaces
 * no longer settle for the `Account.balance` cache. Omit it only when genuinely
 * every account is wanted (trial balance, the top bar's whole-book figures).
 *
 * An empty array means "no accounts", not "all": the caller had nothing to show,
 * so the answer is an empty map with no query at all.
 *
 * `asOf = null` drops the date ceiling: every posted line counts, whatever its
 * date. That is what the `Account.balance` cache always held, and it is what a
 * credit gate wants — a sale dated next week is still money the customer owes,
 * and excluding it would hand out credit against an understated balance. Any
 * surface that reports a position "as of" a date must pass a real date.
 */
export async function aggregateClosingAsOf(
    asOf: Date | null,
    nbMap: Map<number, "DEBIT" | "CREDIT">,
    accountIds?: number[],
    db: LedgerReadClient = prisma,
): Promise<Map<number, number>> {
    if (accountIds && accountIds.length === 0) return new Map();
    // One after another: inside a transaction (one connection) pg 9 refuses parallel queries.
    const sums = await db.voucherGlLine.groupBy({
        by: ["accountId", "type"],
        _sum: { amount: true },
        where: {
            ...(accountIds ? { accountId: { in: accountIds } } : {}),
            universalVoucher: { ...ledgerStatusFilterUv(), ...(asOf ? onOrBeforeOrOpening(asOf) : {}) },
        },
    });
    const masterOpening = await loadMasterOpeningBalances(nbMap, accountIds, db);
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
 * Closing balance, from the ledger, for a known handful of accounts.
 *
 * The one entry point for every surface that used to read the `Account.balance`
 * cache because re-summing "felt expensive": a paginated party list, a
 * credit-limit check, a till's own accounts. Since each counter holds a full
 * local replica, summing a few accounts' GL lines is an indexed local query —
 * cheap enough that there is no reason to show a figure that can drift.
 *
 * Returns rupees, keyed by account id. Accounts with neither movement nor a
 * master opening are simply absent — read a miss as ₹0. Pass `asOf = null` for
 * "everything posted, whatever its date" — the figure the cache used to hold.
 *
 * Every balance on screen is read this way (or `aggregateClosingAsOf` for the
 * whole chart) — the `Account.balance` cache is no longer read for display.
 */
export async function closingForAccounts(
    asOf: Date | null,
    accountIds: number[],
    db: LedgerReadClient = prisma,
): Promise<Map<number, number>> {
    const ids = [...new Set(accountIds)];
    if (ids.length === 0) return new Map();
    const nbMap = await loadNormalBalanceMap(ids, db);
    return aggregateClosingAsOf(asOf, nbMap, ids, db);
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
 * Every opening — master figure (Account.openingBalance) or opening bill
 * (`OPENING` voucher, party leg only) — is one-sided, and goes to the opening
 * bucket whatever its date (`onOrBeforeOrOpening`), never to debits / credits.
 * That keeps the Trial Balance's Debit and Credit columns equal, while the
 * one-sided slack shows as its "Difference in opening balances" row.
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
            where: { universalVoucher: { ...ledgerStatusFilterUv(), OR: [{ date: { lt: from } }, { type: OPENING_TYPE }] } },
        }),
        prisma.voucherGlLine.groupBy({
            by: ["accountId", "type"],
            _sum: { amount: true },
            where: { universalVoucher: { ...ledgerStatusFilterUv(), type: { not: OPENING_TYPE }, date: { gte: from, lte: to } } },
        }),
        loadMasterOpeningBalances(nbMap),
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
    // Master openings → opening bucket. One-sided by nature, so they must NOT
    // enter the period debits / credits columns — otherwise the Trial
    // Balance's Dr column ≠ Cr column.
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
