// Outstandings computation — shared between Receivables, Payables, and Ledger
// outstanding reports. Walks the AccountGroup hierarchy under "Sundry Debtors"
// or "Sundry Creditors", collects open Invoice and Voucher rows, subtracts
// allocations, and buckets the outstanding by age.

import { prisma } from "@/lib/prisma";

export type AgeingBucket = "b0_30" | "b30_60" | "b60_90" | "b90_plus";

export type Buckets = Record<AgeingBucket, number>;

export type OutstandingBill = {
    kind:        "invoice" | "voucher";
    id:          number;
    ref:         string;
    billDate:    string;
    dueDate:     string;
    totalAmount: number;
    paid:        number;
    outstanding: number;
    daysOverdue: number;
    bucket:      AgeingBucket;
};

export type PartyOutstanding = {
    accountId:        number;
    accountName:      string;
    customerId:       number | null;
    companyId:        number | null;
    totalOutstanding: number;
    buckets:          Buckets;
    billCount:        number;
};

export type OutstandingsReport = {
    asOf:             string;
    groupName:        string;
    parties:          PartyOutstanding[];
    totalOutstanding: number;
    buckets:          Buckets;
};

export type LedgerOutstanding = {
    accountId:        number;
    accountName:      string;
    asOf:             string;
    bills:            OutstandingBill[];
    totalOutstanding: number;
    buckets:          Buckets;
};

const DEFAULT_DUE_DAYS = 30;
const EMPTY_BUCKETS: Buckets = { b0_30: 0, b30_60: 0, b60_90: 0, b90_plus: 0 };

function emptyBuckets(): Buckets {
    return { ...EMPTY_BUCKETS };
}

function daysBetween(a: Date, b: Date): number {
    const ms = b.getTime() - a.getTime();
    return Math.max(0, Math.floor(ms / 86_400_000));
}

function bucketFor(days: number): AgeingBucket {
    if (days <= 30) return "b0_30";
    if (days <= 60) return "b30_60";
    if (days <= 90) return "b60_90";
    return "b90_plus";
}

function sumByTarget(allocs: { targetId: number; amount: unknown }[]): Record<number, number> {
    return allocs.reduce<Record<number, number>>((acc, a) => {
        acc[a.targetId] = (acc[a.targetId] ?? 0) + Number(a.amount);
        return acc;
    }, {});
}

async function accountIdsUnderGroup(groupName: string): Promise<number[]> {
    const groups = await prisma.accountGroup.findMany({
        where: { isActive: true },
        select: { id: true, name: true, parentId: true },
    });
    const root = groups.find((g) => g.name === groupName);
    if (!root) return [];

    const included = new Set<number>([root.id]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const g of groups) {
            if (g.parentId !== null && included.has(g.parentId) && !included.has(g.id)) {
                included.add(g.id);
                grew = true;
            }
        }
    }

    const accounts = await prisma.account.findMany({
        where: { isActive: true, groupId: { in: Array.from(included) } },
        select: { id: true },
    });
    return accounts.map((a) => a.id);
}

type RawBill = {
    kind:        "invoice" | "voucher";
    id:          number;
    accountId:   number;
    ref:         string;
    billDate:    Date;
    dueDate:     Date;
    totalAmount: number;
};

async function loadOpenBills(accountIds: number[], asOf: Date): Promise<{
    bills:        RawBill[];
    paidByInv:    Record<number, number>;
    paidByVch:    Record<number, number>;
}> {
    if (accountIds.length === 0) {
        return { bills: [], paidByInv: {}, paidByVch: {} };
    }

    const [invoices, vouchers] = await Promise.all([
        prisma.invoice.findMany({
            where: {
                accountId: { in: accountIds },
                deletedAt: null,
                status:    { not: "VOID" },
                issueDate: { lte: asOf },
            },
            select: {
                id: true, accountId: true, number: true,
                issueDate: true, dueDate: true, totalAmount: true,
            },
        }),
        prisma.voucher.findMany({
            where: {
                partyAccountId: { in: accountIds },
                deletedAt:      null,
                status:         { not: "CANCELLED" },
                date:           { lte: asOf },
            },
            select: {
                id: true, partyAccountId: true, reference: true,
                date: true, totalAmount: true,
            },
        }),
    ]);

    const invIds = invoices.map((i) => i.id);
    const vchIds = vouchers.map((v) => v.id);
    const [invAllocs, vchAllocs] = await Promise.all([
        invIds.length > 0
            ? prisma.voucherAllocation.findMany({
                where: { targetType: "INVOICE", targetId: { in: invIds } },
                select: { targetId: true, amount: true },
            })
            : Promise.resolve([] as { targetId: number; amount: unknown }[]),
        vchIds.length > 0
            ? prisma.voucherAllocation.findMany({
                where: { targetType: "VOUCHER", targetId: { in: vchIds } },
                select: { targetId: true, amount: true },
            })
            : Promise.resolve([] as { targetId: number; amount: unknown }[]),
    ]);

    const bills: RawBill[] = [];
    for (const inv of invoices) {
        if (inv.accountId === null) continue;
        bills.push({
            kind:        "invoice",
            id:          inv.id,
            accountId:   inv.accountId,
            ref:         inv.number,
            billDate:    inv.issueDate,
            dueDate:     inv.dueDate,
            totalAmount: Number(inv.totalAmount),
        });
    }
    for (const v of vouchers) {
        if (v.partyAccountId === null) continue;
        const due = new Date(v.date);
        due.setDate(due.getDate() + DEFAULT_DUE_DAYS);
        bills.push({
            kind:        "voucher",
            id:          v.id,
            accountId:   v.partyAccountId,
            ref:         v.reference,
            billDate:    v.date,
            dueDate:     due,
            totalAmount: Number(v.totalAmount),
        });
    }

    return {
        bills,
        paidByInv: sumByTarget(invAllocs),
        paidByVch: sumByTarget(vchAllocs),
    };
}

function toOutstandingBill(raw: RawBill, paid: number, asOf: Date): OutstandingBill | null {
    const outstanding = raw.totalAmount - paid;
    if (outstanding <= 0.005) return null;
    const days = daysBetween(raw.billDate, asOf);
    return {
        kind:        raw.kind,
        id:          raw.id,
        ref:         raw.ref,
        billDate:    raw.billDate.toISOString(),
        dueDate:     raw.dueDate.toISOString(),
        totalAmount: raw.totalAmount,
        paid,
        outstanding,
        daysOverdue: days,
        bucket:      bucketFor(days),
    };
}

export async function getOutstandings(
    groupName: "Sundry Debtors" | "Sundry Creditors",
    asOf: Date = new Date(),
): Promise<OutstandingsReport> {
    const accountIds = await accountIdsUnderGroup(groupName);
    if (accountIds.length === 0) {
        return {
            asOf:             asOf.toISOString(),
            groupName,
            parties:          [],
            totalOutstanding: 0,
            buckets:          emptyBuckets(),
        };
    }

    const [accounts, { bills, paidByInv, paidByVch }] = await Promise.all([
        prisma.account.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, name: true, customerId: true, companyId: true },
            orderBy: [{ name: "asc" }],
        }),
        loadOpenBills(accountIds, asOf),
    ]);

    const partyMap = new Map<number, PartyOutstanding>();
    for (const a of accounts) {
        partyMap.set(a.id, {
            accountId:        a.id,
            accountName:      a.name,
            customerId:       a.customerId,
            companyId:        a.companyId,
            totalOutstanding: 0,
            buckets:          emptyBuckets(),
            billCount:        0,
        });
    }

    for (const raw of bills) {
        const paid = raw.kind === "invoice" ? (paidByInv[raw.id] ?? 0) : (paidByVch[raw.id] ?? 0);
        const bill = toOutstandingBill(raw, paid, asOf);
        if (!bill) continue;
        const party = partyMap.get(raw.accountId);
        if (!party) continue;
        party.buckets[bill.bucket] += bill.outstanding;
        party.totalOutstanding     += bill.outstanding;
        party.billCount            += 1;
    }

    const parties = Array.from(partyMap.values())
        .filter((p) => p.totalOutstanding > 0.005)
        .sort((a, b) => b.totalOutstanding - a.totalOutstanding);

    const totalBuckets = emptyBuckets();
    let totalOutstanding = 0;
    for (const p of parties) {
        totalOutstanding   += p.totalOutstanding;
        totalBuckets.b0_30    += p.buckets.b0_30;
        totalBuckets.b30_60   += p.buckets.b30_60;
        totalBuckets.b60_90   += p.buckets.b60_90;
        totalBuckets.b90_plus += p.buckets.b90_plus;
    }

    return {
        asOf: asOf.toISOString(),
        groupName,
        parties,
        totalOutstanding,
        buckets: totalBuckets,
    };
}

export async function getLedgerOutstanding(
    accountId: number,
    asOf: Date = new Date(),
): Promise<LedgerOutstanding | null> {
    const account = await prisma.account.findUnique({
        where:  { id: accountId },
        select: { id: true, name: true },
    });
    if (!account) return null;

    const { bills, paidByInv, paidByVch } = await loadOpenBills([accountId], asOf);
    const buckets = emptyBuckets();
    let totalOutstanding = 0;
    const out: OutstandingBill[] = [];

    for (const raw of bills) {
        const paid = raw.kind === "invoice" ? (paidByInv[raw.id] ?? 0) : (paidByVch[raw.id] ?? 0);
        const bill = toOutstandingBill(raw, paid, asOf);
        if (!bill) continue;
        out.push(bill);
        buckets[bill.bucket] += bill.outstanding;
        totalOutstanding     += bill.outstanding;
    }

    out.sort((a, b) => +new Date(b.billDate) - +new Date(a.billDate));

    return {
        accountId:   account.id,
        accountName: account.name,
        asOf:        asOf.toISOString(),
        bills:       out,
        totalOutstanding,
        buckets,
    };
}
