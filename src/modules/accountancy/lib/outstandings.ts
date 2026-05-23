// Outstandings computation — shared between Receivables, Payables, and Ledger
// outstanding reports. Walks the AccountGroup hierarchy under "Sundry Debtors"
// or "Sundry Creditors", collects open Invoice and Voucher rows, subtracts
// allocations, and buckets the outstanding by age.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

export type AgeingBucket = "b0_30" | "b30_60" | "b60_90" | "b90_plus";

export type Buckets = Record<AgeingBucket, number>;

export type OutstandingBill = {
    // "sale" / "purchase" — InvVoucher (SALE / POS / PURCHASE)
    // "voucher"           — finance Voucher (CREDIT_NOTE / DEBIT_NOTE)
    // The legacy "invoice" kind was retired with the Invoice → InvVoucher
    // consolidation (2026-05-24).
    kind:        "voucher" | "sale" | "purchase";
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

export type OutstandingBillFlat = OutstandingBill & {
    accountId:   number;
    accountName: string;
};

export type OutstandingsReport = {
    asOf:             string;
    groupName:        string;
    parties:          PartyOutstanding[];
    bills:            OutstandingBillFlat[];
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

    const [vouchers, accounts] = await Promise.all([
        // Only bill-shaped vouchers (CREDIT_NOTE / DEBIT_NOTE) count as
        // outstanding here. RECEIPT / PAYMENT are settlements — they appear
        // in VoucherAllocation as `sourceType=VOUCHER` and nett against the
        // bill's JE; including them again as "open bills" would double-count
        // them as false positives. CONTRA / JOURNAL never sit against a party.
        prisma.voucher.findMany({
            where: {
                partyAccountId: { in: accountIds },
                type:           { in: ["CREDIT_NOTE", "DEBIT_NOTE"] },
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

    // OR-match clauses for the InvVoucher lookup. Modern rows carry
    // `accountId` directly (added 2026-05-24); legacy rows are resolved via
    // the partyType+partyId pair against the person/company identity maps.
    const partyOr: Array<
        | { accountId: { in: number[] } }
        | { partyType: string; partyId: { in: number[] } }
    > = [];
    partyOr.push({ accountId: { in: accountIds } });
    if (personIds.length > 0) partyOr.push({ partyType: "customer", partyId: { in: personIds } });
    if (companyIds.length  > 0) partyOr.push({ partyType: "company",  partyId: { in: companyIds  } });

    // POS InvVouchers carry AR exactly like a SALE — only their settlement
    // flow differs (immediate receipt voucher at the counter). They must
    // count as receivables-side bills so credit-on-POS sales (partial
    // payments, future feature) show up correctly here, and so the
    // PaidByJe allocation logic can net them out for cash-paid POS.
    const saleSideTypes = ["SALE", "POS"] as const;
    const purchaseSideTypes = ["PURCHASE"] as const;
    const invVouchers = accountIds.length === 0 ? [] : await prisma.invVoucher.findMany({
        where: {
            ...(invType === "BOTH"
                ? { type: { in: [...saleSideTypes, ...purchaseSideTypes] } }
                : invType === "SALE"
                    ? { type: { in: [...saleSideTypes] } }
                    : { type: { in: [...purchaseSideTypes] } }),
            status:    "POSTED",
            deletedAt: null,
            date:      { lte: asOf },
            OR: partyOr,
        },
        select: {
            id: true, type: true, reference: true, date: true,
            totalAmount: true, amountReceived: true,
            accountId: true,
            partyType: true, partyId: true, journalEntryId: true,
            creditPeriodDays: true,
        },
    });

    // Allocations may target any of the three voucher kinds — JournalEntry is
    // how a Receipt voucher settles a posted Sale (whose JE was created at post).
    const jeIds = invVouchers
        .map((v) => v.journalEntryId)
        .filter((x): x is number => x !== null);

    const [vchAllocs, jeAllocs] = await Promise.all([
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

    const paidByVch = sumByTarget(vchAllocs);
    const paidByJe  = sumByTarget(jeAllocs);

    const bills: RawBill[] = [];

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
        // Prefer the explicit `accountId` FK added on 2026-05-24; fall back
        // to the legacy partyType+partyId resolution dance for old rows
        // written before the column existed.
        const accountId = v.accountId
            ?? (v.partyId === null
                ? null
                : v.partyType === "customer"
                    ? personToAcc[v.partyId] ?? null
                    : v.partyType === "company"
                        ? companyToAcc[v.partyId] ?? null
                        : null);
        if (accountId === null) continue;
        const due = new Date(v.date);
        due.setDate(due.getDate() + (v.creditPeriodDays ?? DEFAULT_DUE_DAYS));
        const total = Number(v.totalAmount);
        // Paid = up-front cash recorded on the voucher + any later receipts
        // allocated against the linked GL journal entry.
        const paid =
            Number(v.amountReceived) +
            (v.journalEntryId !== null ? (paidByJe[v.journalEntryId] ?? 0) : 0);
        bills.push({
            kind:        v.type === "SALE" || v.type === "POS" ? "sale" : "purchase",
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
            bills:            [],
            totalOutstanding: 0,
            buckets:          emptyBuckets(),
        };
    }

    const invType = groupName === ACCOUNT_GROUPS.SUNDRY_DEBTORS ? "SALE" : "PURCHASE";
    const [accounts, bills] = await Promise.all([
        prisma.account.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, name: true, personId: true, companyId: true },
            orderBy: [{ name: "asc" }],
        }),
        loadOpenBills(accountIds, asOf, invType),
    ]);

    const partyMap = new Map<number, PartyOutstanding>();
    const accountNameMap = new Map<number, string>();
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
        accountNameMap.set(a.id, a.name);
    }

    const flatBills: OutstandingBillFlat[] = [];

    for (const raw of bills) {
        const bill = toOutstandingBill(raw, asOf);
        if (!bill) continue;
        const party = partyMap.get(raw.accountId);
        if (!party) continue;
        party.buckets[bill.bucket] += bill.outstanding;
        party.totalOutstanding     += bill.outstanding;
        party.billCount            += 1;
        flatBills.push({
            ...bill,
            accountId:   raw.accountId,
            accountName: accountNameMap.get(raw.accountId) ?? "",
        });
    }

    // Most-overdue first; oldest bills are the ones to chase.
    flatBills.sort((a, b) => b.daysOverdue - a.daysOverdue);

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
        bills: flatBills,
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
