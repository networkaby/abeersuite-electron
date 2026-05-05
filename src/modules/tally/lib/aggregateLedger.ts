// Single-pass aggregation of POSTED JournalLines per account.
// Returns opening / debits / credits / closing — given a date range (or just an asOf for closing-only).

import { prisma } from "@/lib/prisma";
import { balanceDelta } from "./balance";

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

/** Closing balances of every account as of a date.  Map<accountId, closing> in rupees. */
export async function aggregateClosingAsOf(
    asOf: Date,
    nbMap: Map<number, "DEBIT" | "CREDIT">,
): Promise<Map<number, number>> {
    const sums = await prisma.journalLine.groupBy({
        by: ["accountId", "type"],
        _sum: { amount: true },
        where: { journalEntry: { status: "POSTED", deletedAt: null, date: { lte: asOf } } },
    });
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
        closing.set(accId, nb === "DEBIT" ? v.d - v.c : v.c - v.d);
    }
    return closing;
}

/** Opening + transactions + closing per account over a date range. */
export async function aggregateRange(
    from: Date,
    to: Date,
    nbMap: Map<number, "DEBIT" | "CREDIT">,
): Promise<Map<number, AccountAggregate>> {
    const [openingSums, periodSums] = await Promise.all([
        prisma.journalLine.groupBy({
            by: ["accountId", "type"],
            _sum: { amount: true },
            where: { journalEntry: { status: "POSTED", deletedAt: null, date: { lt: from } } },
        }),
        prisma.journalLine.groupBy({
            by: ["accountId", "type"],
            _sum: { amount: true },
            where: { journalEntry: { status: "POSTED", deletedAt: null, date: { gte: from, lte: to } } },
        }),
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

/** Net of (income - expense) over a range — this is the Net Profit/Loss for that period.
 *  Positive = profit, negative = loss. */
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

    const sumNetCredit = async (ids: number[]): Promise<number> => {
        if (ids.length === 0) return 0;
        const sums = await prisma.journalLine.groupBy({
            by: ["type"],
            _sum: { amount: true },
            where: {
                accountId: { in: ids },
                journalEntry: { status: "POSTED", deletedAt: null, date: { gte: from, lte: to } },
            },
        });
        let dr = 0, cr = 0;
        for (const s of sums) {
            const amt = Number(s._sum.amount ?? 0);
            if (s.type === "DEBIT") dr += amt;
            else                    cr += amt;
        }
        return cr - dr; // income side (CREDIT normal) → positive when income
    };
    const sumNetDebit = async (ids: number[]): Promise<number> => {
        if (ids.length === 0) return 0;
        const sums = await prisma.journalLine.groupBy({
            by: ["type"],
            _sum: { amount: true },
            where: {
                accountId: { in: ids },
                journalEntry: { status: "POSTED", deletedAt: null, date: { gte: from, lte: to } },
            },
        });
        let dr = 0, cr = 0;
        for (const s of sums) {
            const amt = Number(s._sum.amount ?? 0);
            if (s.type === "DEBIT") dr += amt;
            else                    cr += amt;
        }
        return dr - cr; // expense side (DEBIT normal) → positive when expense
    };

    const income  = await sumNetCredit(incomeIds);
    const expense = await sumNetDebit(expenseIds);
    return income - expense;
}
