// Outstandings computation — shared between Receivables, Payables, and Ledger
// outstanding reports. Walks the AccountGroup hierarchy under "Sundry Debtors"
// or "Sundry Creditors", collects open Invoice and Voucher rows, subtracts
// allocations, and buckets the outstanding by age.

import { prisma } from "@/shared/lib/prisma/prismaClient";

export type AgeingBucket = "b0_30" | "b30_60" | "b60_90" | "b90_plus";

export type Buckets = Record<AgeingBucket, number>;

export type OutstandingBill = {
    // "invoice" — finance Invoice row · "voucher" — finance Voucher row
    // "sale" / "purchase" — InvVoucher (inventory voucher) of that type
    kind:        "invoice" | "voucher" | "sale" | "purchase";
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
    personId:       number | null;
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
    kind:        OutstandingBill["kind"];
    id:          number;
    accountId:   number;
    ref:         string;
    billDate:    Date;
    dueDate:     Date;
    totalAmount: number;
    paid:        number;
};

// `invType` controls which side of inventory vouchers we sweep in:
//   "SALE"     — for Receivables (debtors, customers owe us)
//   "PURCHASE" — for Payables    (creditors, we owe vendors)
//   "BOTH"     — for single-ledger drill-down (show whatever's open against
//                this party regardless of direction)
async function loadOpenBills(
    accountIds: number[],
    asOf: Date,
    invType: "SALE" | "PURCHASE" | "BOTH",
): Promise<RawBill[]> {
    if (accountIds.length === 0) return [];

    const [invoices, vouchers, accounts] = await Promise.all([
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
        prisma.account.findMany({
            where:  { id: { in: accountIds } },
            select: { id: true, personId: true, companyId: true },
        }),
    ]);

    const invIds = invoices.map((i) => i.id);
    const vchIds = vouchers.map((v) => v.id);

    // Build identity → account maps so we can resolve InvVoucher.partyId back
    // to the matching ledger row.
    const personToAcc: Record<number, number> = {};
    const companyToAcc:  Record<number, number> = {};
    for (const a of accounts) {
        if (a.personId !== null) personToAcc[a.personId] = a.id;
        if (a.companyId  !== null) companyToAcc[a.companyId]   = a.id;
    }
    const personIds = Object.keys(personToAcc).map(Number);
    const companyIds  = Object.keys(companyToAcc).map(Number);

    const partyOr: { partyType: string; partyId: { in: number[] } }[] = [];
    if (personIds.length > 0) partyOr.push({ partyType: "customer", partyId: { in: personIds } });
    if (companyIds.length  > 0) partyOr.push({ partyType: "company",  partyId: { in: companyIds  } });

    const invVouchers = partyOr.length === 0 ? [] : await prisma.invVoucher.findMany({
        where: {
            ...(invType === "BOTH"
                ? { type: { in: ["SALE", "PURCHASE"] } }
                : { type: invType }),
            status:    "POSTED",
            deletedAt: null,
            date:      { lte: asOf },
            OR: partyOr,
        },
        select: {
            id: true, type: true, reference: true, date: true,
            totalAmount: true, amountReceived: true,
            partyType: true, partyId: true, journalEntryId: true,
        },
    });

    // Allocations may target any of the three voucher kinds — JournalEntry is
    // how a Receipt voucher settles a posted Sale (whose JE was created at post).
    const jeIds = invVouchers
        .map((v) => v.journalEntryId)
        .filter((x): x is number => x !== null);

    const [invAllocs, vchAllocs, jeAllocs] = await Promise.all([
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
        jeIds.length > 0
            ? prisma.voucherAllocation.findMany({
                where: { targetType: "JOURNAL_ENTRY", targetId: { in: jeIds } },
                select: { targetId: true, amount: true },
            })
            : Promise.resolve([] as { targetId: number; amount: unknown }[]),
    ]);

    const paidByInv = sumByTarget(invAllocs);
    const paidByVch = sumByTarget(vchAllocs);
    const paidByJe  = sumByTarget(jeAllocs);

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
            paid:        paidByInv[inv.id] ?? 0,
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
            paid:        paidByVch[v.id] ?? 0,
        });
    }

    for (const v of invVouchers) {
        if (v.partyId === null) continue;
        const accountId = v.partyType === "customer"
            ? personToAcc[v.partyId] ?? null
            : v.partyType === "company"
                ? companyToAcc[v.partyId] ?? null
                : null;
        if (accountId === null) continue;
        const due = new Date(v.date);
        due.setDate(due.getDate() + DEFAULT_DUE_DAYS);
        const total = Number(v.totalAmount);
        // Paid = up-front cash recorded on the voucher + any later receipts
        // allocated against the linked GL journal entry.
        const paid =
            Number(v.amountReceived) +
            (v.journalEntryId !== null ? (paidByJe[v.journalEntryId] ?? 0) : 0);
        bills.push({
            kind:        v.type === "SALE" ? "sale" : "purchase",
            id:          v.id,
            accountId,
            ref:         v.reference,
            billDate:    v.date,
            dueDate:     due,
            totalAmount: total,
            paid,
        });
    }

    return bills;
}

function toOutstandingBill(raw: RawBill, asOf: Date): OutstandingBill | null {
    const outstanding = raw.totalAmount - raw.paid;
    if (outstanding <= 0.005) return null;
    const days = daysBetween(raw.billDate, asOf);
    return {
        kind:        raw.kind,
        id:          raw.id,
        ref:         raw.ref,
        billDate:    raw.billDate.toISOString(),
        dueDate:     raw.dueDate.toISOString(),
        totalAmount: raw.totalAmount,
        paid:        raw.paid,
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

    const invType = groupName === "Sundry Debtors" ? "SALE" : "PURCHASE";
    const [accounts, bills] = await Promise.all([
        prisma.account.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, name: true, personId: true, companyId: true },
            orderBy: [{ name: "asc" }],
        }),
        loadOpenBills(accountIds, asOf, invType),
    ]);

    const partyMap = new Map<number, PartyOutstanding>();
    for (const a of accounts) {
        partyMap.set(a.id, {
            accountId:        a.id,
            accountName:      a.name,
            personId:       a.personId,
            companyId:        a.companyId,
            totalOutstanding: 0,
            buckets:          emptyBuckets(),
            billCount:        0,
        });
    }

    for (const raw of bills) {
        const bill = toOutstandingBill(raw, asOf);
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

    const bills = await loadOpenBills([accountId], asOf, "BOTH");
    const buckets = emptyBuckets();
    let totalOutstanding = 0;
    const out: OutstandingBill[] = [];

    for (const raw of bills) {
        const bill = toOutstandingBill(raw, asOf);
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
