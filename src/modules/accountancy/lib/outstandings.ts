// Outstandings computation — shared between Receivables, Payables, and Ledger
// outstanding reports. Walks the AccountGroup hierarchy under "Sundry Debtors"
// or "Sundry Creditors", collects open Invoice and Voucher rows, subtracts
// allocations, and buckets the outstanding by age.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
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

/**
 * Phase 4 G1: total RECEIPT allocations against each given journal entry, read
 * from the universal-voucher spine (UNIVERSAL_VOUCHER allocations), returned
 * keyed by the LEGACY JE id — so callers that key by `journalEntryId` are a
 * drop-in. Dual-target (postReceiptVoucher + the backfill) keeps these identical
 * to the old JOURNAL_ENTRY sums; reading the spine lets us drop the JE
 * allocations in G1d/G5. Accepts the global client or a tx.
 */
export async function sumReceiptAllocations(
    db: Prisma.TransactionClient,
    universalVoucherIds: number[],
): Promise<Record<number, number>> {
    const ids = [...new Set(universalVoucherIds)];
    if (ids.length === 0) return {};
    const allocs = await db.voucherAllocation.findMany({
        where:  { targetType: "UNIVERSAL_VOUCHER", targetId: { in: ids } },
        select: { targetId: true, amount: true },
    });
    const out: Record<number, number> = {};
    for (const a of allocs) out[a.targetId] = (out[a.targetId] ?? 0) + Number(a.amount);
    return out;
}

/**
 * Phase 4 G4b: the role=TENDER GL lines for each given journal entry, read from
 * the universal-voucher spine, keyed by the LEGACY JE id — a drop-in for the old
 * `InvVoucherTender.findMany` grouped by InvVoucher. Callers apply the non-AR
 * filter themselves (each knows its bill's AR-party account). Accepts the global
 * client or a tx. Historical spine lines are role-tagged by `backfillTenderRoles`
 * in the backfill script; new posts are tagged at write time by the GL builder.
 */
export async function loadTenderLines(
    db: Prisma.TransactionClient,
    universalVoucherIds: number[],
): Promise<Map<number, { accountId: number; amount: number }[]>> {
    const out = new Map<number, { accountId: number; amount: number }[]>();
    const ids = [...new Set(universalVoucherIds)];
    if (ids.length === 0) return out;
    const lines = await db.voucherGlLine.findMany({
        where:  { role: "TENDER", universalVoucherId: { in: ids } },
        select: { accountId: true, amount: true, universalVoucherId: true },
    });
    for (const l of lines) {
        const arr = out.get(l.universalVoucherId) ?? [];
        arr.push({ accountId: l.accountId, amount: Number(l.amount) });
        out.set(l.universalVoucherId, arr);
    }
    return out;
}

/**
 * Phase 4 G5: total allocations settling each finance Voucher (CREDIT_NOTE /
 * DEBIT_NOTE bill), read from the universal-voucher spine (UNIVERSAL_VOUCHER
 * allocations keyed by the bill's `universalVoucherId`), returned keyed by the
 * LEGACY Voucher id — a drop-in for the old `targetType=VOUCHER` sum so callers
 * that key by `voucher.id` are unchanged. Re-homes off `targetType=VOUCHER`.
 */
export async function sumVoucherAllocations(
    db: Prisma.TransactionClient,
    voucherIds: number[],
): Promise<Record<number, number>> {
    // Phase 5 5E: the spine IS the finance voucher — `voucherIds` ARE spine ids,
    // so this is now a direct allocation lookup (the old Voucher→spine hop is gone).
    const ids = [...new Set(voucherIds)];
    if (ids.length === 0) return {};
    const allocs = await db.voucherAllocation.findMany({
        where:  { targetType: "UNIVERSAL_VOUCHER", targetId: { in: ids } },
        select: { targetId: true, amount: true },
    });
    const out: Record<number, number> = {};
    for (const a of allocs) out[a.targetId] = (out[a.targetId] ?? 0) + Number(a.amount);
    return out;
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
        // Phase 5 5E: bill-shaped finance vouchers ARE spines now. Total is computed
        // from the debit legs (no stored totalAmount on the spine).
        prisma.universalVoucher.findMany({
            where: {
                partyAccountId: { in: accountIds },
                type:           { in: ["CREDIT_NOTE", "DEBIT_NOTE"] },
                deletedAt:      null,
                status:         { not: "CANCELLED" },
                date:           { lte: asOf },
            },
            select: {
                id: true, partyAccountId: true, voucherNo: true, date: true,
                lines: { select: { type: true, amount: true } },
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

    // OR-match clauses for the InvVoucher lookup. Phase 5 5D-4: the live party
    // link is on the spine (universalVoucher.partyAccountId); legacy rows are
    // resolved via the partyType+partyId pair against the identity maps.
    const partyOr: Array<
        | { universalVoucher: { partyAccountId: { in: number[] } } }
        | { partyType: string; partyId: { in: number[] } }
    > = [];
    partyOr.push({ universalVoucher: { partyAccountId: { in: accountIds } } });
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
            universalVoucher: { status: "POSTED", deletedAt: null, date: { lte: asOf } },   // 5D-8 lifecycle + 5D-10 date on spine
            OR: partyOr,
        },
        select: {
            id: true, type: true,
            totalAmount: true,
            universalVoucher: { select: { partyAccountId: true, voucherNo: true, date: true } },   // 5D-4 party + 5D-6 ref + 5D-10 date
            partyType: true, partyId: true, universalVoucherId: true,
            creditPeriodDays: true,
        },
    });

    // Settlements + tenders read off the universal-voucher spine, keyed by the
    // bill's universalVoucherId (G5 — the direct spine link, replaces the JE hop).
    const uvIds = invVouchers
        .map((v) => v.universalVoucherId)
        .filter((x): x is number => x !== null);

    const [paidByVch, tendersBySpine, paidBySpine] = await Promise.all([
        // CREDIT_NOTE/DEBIT_NOTE bill settlements via the spine (keyed by Voucher id).
        sumVoucherAllocations(prisma, vchIds),
        // Up-front tenders via the spine (role=TENDER), keyed by universalVoucherId.
        loadTenderLines(prisma, uvIds),
        // RECEIPT settlements via the spine, keyed by universalVoucherId.
        sumReceiptAllocations(prisma, uvIds),
    ]);

    const bills: RawBill[] = [];

    for (const v of vouchers) {
        if (v.partyAccountId === null) continue;
        const due = new Date(v.date);
        due.setDate(due.getDate() + DEFAULT_DUE_DAYS);
        bills.push({
            kind:        "voucher",
            id:          v.id,
            accountId:   v.partyAccountId,
            ref:         v.voucherNo ?? formatUvNo(v.id),
            billDate:    v.date,
            dueDate:     due,
            totalAmount: v.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0),
            paid:        paidByVch[v.id] ?? 0,
        });
    }

    for (const v of invVouchers) {
        // Prefer the spine's live party link (5D-4); fall back to the legacy
        // partyType+partyId resolution dance for old rows.
        const accountId = v.universalVoucher?.partyAccountId
            ?? (v.partyId === null
                ? null
                : v.partyType === "customer"
                    ? personToAcc[v.partyId] ?? null
                    : v.partyType === "company"
                        ? companyToAcc[v.partyId] ?? null
                        : null);
        if (accountId === null) continue;
        const due = new Date(v.universalVoucher!.date);   // 5D-10: date on spine
        due.setDate(due.getDate() + (v.creditPeriodDays ?? DEFAULT_DUE_DAYS));
        const total = Number(v.totalAmount);
        // Paid at sale time = sum of non-AR tenders on this voucher
        // (cash / bank / card / wallet). The AR tender row IS the
        // unsettled remainder; later Receipt vouchers chip away at it
        // via the VoucherAllocation → journalEntryId chain (paidByJe).
        const vTenders = v.universalVoucherId !== null ? (tendersBySpine.get(v.universalVoucherId) ?? []) : [];
        const paidAtSale = vTenders
            .filter((t) => t.accountId !== accountId)
            .reduce((s, t) => s + t.amount, 0);
        // Plus any later receipts allocated against the voucher's spine row.
        const paid =
            paidAtSale +
            (v.universalVoucherId !== null ? (paidBySpine[v.universalVoucherId] ?? 0) : 0);
        bills.push({
            kind:        v.type === "SALE" || v.type === "POS" ? "sale" : "purchase",
            id:          v.id,
            accountId,
            ref:         v.universalVoucher?.voucherNo ?? "",
            billDate:    v.universalVoucher!.date,   // 5D-10
            dueDate:     due,
            totalAmount: total,
            paid,
        });
    }

    return bills;
}

// FIFO accessor for POS collect-on-the-go. Returns this customer's OPEN
// sale-side bills (SALE / POS), oldest-first, each with the journalEntryId a
// Receipt voucher allocates against. Self-contained and `tx`-aware so it can run
// inside the sale transaction; mirrors `loadOpenBills`'s paid math exactly but
// scoped to a single ledger and the SALE side only (no regression to the shared
// report path). The shared `OutstandingBill` shape drops journalEntryId, which is
// why FIFO needs its own accessor.
export async function getOpenSaleBillsForFifo(
    tx: Prisma.TransactionClient,
    accountId: number,
    asOf: Date = new Date(),
): Promise<{ universalVoucherId: number; outstanding: number; billDate: Date; ref: string }[]> {
    const account = await tx.account.findUnique({
        where:  { id: accountId },
        select: { id: true, personId: true, companyId: true },
    });
    if (!account) return [];

    // Same OR-match as loadOpenBills: the live party link is on the spine (5D-4);
    // legacy rows resolve via partyType+partyId against the identity maps.
    const partyOr: Array<
        | { universalVoucher: { partyAccountId: { in: number[] } } }
        | { partyType: string; partyId: { in: number[] } }
    > = [{ universalVoucher: { partyAccountId: { in: [accountId] } } }];
    if (account.personId !== null) partyOr.push({ partyType: "customer", partyId: { in: [account.personId] } });
    if (account.companyId !== null) partyOr.push({ partyType: "company", partyId: { in: [account.companyId] } });

    const invVouchers = await tx.invVoucher.findMany({
        where: {
            type:      { in: ["SALE", "POS"] },
            universalVoucher: { status: "POSTED", deletedAt: null, date: { lte: asOf } },   // 5D-8 lifecycle + 5D-10 date on spine
            OR:        partyOr,
        },
        select: {
            id: true, type: true,
            totalAmount: true, universalVoucher: { select: { partyAccountId: true, voucherNo: true, date: true } },   // 5D-4 + 5D-6 + 5D-10 date
            partyType: true, partyId: true, universalVoucherId: true,
        },
    });

    const uvIds = invVouchers
        .map((v) => v.universalVoucherId)
        .filter((x): x is number => x !== null);

    const [tendersBySpine, paidBySpine] = await Promise.all([
        // Up-front tenders via the spine (role=TENDER), keyed by universalVoucherId.
        loadTenderLines(tx, uvIds),
        // RECEIPT settlements via the spine, keyed by universalVoucherId.
        sumReceiptAllocations(tx, uvIds),
    ]);

    const out: { universalVoucherId: number; outstanding: number; billDate: Date; ref: string }[] = [];
    for (const v of invVouchers) {
        if (v.universalVoucherId === null) continue;
        const resolved = v.universalVoucher?.partyAccountId ?? accountId; // single-ledger scope — partyOr already matched
        const total = Number(v.totalAmount);
        const vTenders = tendersBySpine.get(v.universalVoucherId) ?? [];
        const paidAtSale = vTenders
            .filter((t) => t.accountId !== resolved)
            .reduce((s, t) => s + t.amount, 0);
        const paid = paidAtSale + (paidBySpine[v.universalVoucherId] ?? 0);
        const outstanding = total - paid;
        if (outstanding > 0.005) {
            out.push({ universalVoucherId: v.universalVoucherId, outstanding, billDate: v.universalVoucher!.date, ref: v.universalVoucher?.voucherNo ?? "" });
        }
    }
    // Oldest-first → FIFO.
    out.sort((a, b) => +a.billDate - +b.billDate);
    return out;
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
