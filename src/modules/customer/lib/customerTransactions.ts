import type { PrismaClient } from "@/generated/prisma/client";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { defaultNormalBalanceForGroupType, type GroupTypeStr } from "@/modules/accountancy/lib/groupNature";
import { loadTenderLines } from "@/modules/accountancy/lib/outstandings";
import { sumLinked } from "@/modules/accountancy/lib/billLink";
import type { TxInvVoucher } from "@/modules/customer/components/TransactionsTable";

const VOUCHER_SELECT = {
    id: true,
    totalAmount: true,
    universalVoucherId: true,
    universalVoucher: {
        select: {
            createdById: true,
            partyAccountId: true,
            voucherNo: true,
            status: true,
            date: true,
            type: true,
            branch: { select: { name: true } },
        },
    },
} as const;

type RawVoucher = {
    id: number;
    totalAmount: { toString(): string } | number;
    universalVoucherId: number | null;
    universalVoucher: {
        createdById: number | null;
        partyAccountId: number | null;
        voucherNo: string | null;
        status: string;
        date: Date;
        type: string;
        branch: { name: string } | null;
    } | null;
};

type AccountForOpening = {
    id: number;
    openingBalance: { toString(): string } | number | null;
    openingBalanceType: "DEBIT" | "CREDIT" | null;
    openingBalanceDate: Date | null;
    normalBalance: "DEBIT" | "CREDIT" | null;
    group: { type: string } | null;
};

export const CUSTOMER_ACCOUNT_OPENING_SELECT = {
    id: true,
    openingBalance: true,
    openingBalanceType: true,
    openingBalanceDate: true,
    normalBalance: true,
    group: { select: { type: true } },
} as const;

/** Master-page opening balance, signed for customer outstanding (total − paid).
 *  Folded in whenever `openingBalanceDate` is on/before `to` — mirrors
 *  aggregateRange's rule in aggregateLedger.ts (folded into the opening
 *  bucket whenever dated <= `to`, regardless of whether that falls before or
 *  inside the period) so the customer Transactions view and the accountancy
 *  reports never disagree about which period an opening balance belongs to. */
export function signedMasterOpening(account: AccountForOpening, to: Date): number {
    const nb = account.normalBalance
        ?? (account.group?.type ? defaultNormalBalanceForGroupType(account.group.type as GroupTypeStr) : "DEBIT");
    if (account.openingBalance == null || !account.openingBalanceType) return 0;
    if (account.openingBalanceDate && account.openingBalanceDate > to) return 0;
    return balanceDelta(nb, account.openingBalanceType, toNumber(account.openingBalance));
}

/** Synthetic first row — mirrors product OPENING row pattern. */
export function buildOpeningVoucherRow(
    accountId: number,
    signedOpening: number,
    periodFrom: Date,
): TxInvVoucher | null {
    if (Math.abs(signedOpening) < 0.005) return null;
    const total = signedOpening > 0 ? signedOpening : 0;
    const paid = signedOpening < 0 ? -signedOpening : 0;
    return {
        id: -accountId,
        reference: "Opening balance",
        type: "OPENING",
        status: "N/A",
        date: periodFrom.toISOString(),
        totalAmount: total.toFixed(2),
        amountPaid: paid.toFixed(2),
        branch: { name: "" },
        createdBy: { name: "" },
    };
}

async function enrichVouchers(
    prisma: PrismaClient,
    rawVouchers: RawVoucher[],
    arAccountId: number | null,
): Promise<TxInvVoucher[]> {
    const uvIds = rawVouchers
        .map((v) => v.universalVoucherId)
        .filter((x): x is number => x !== null);
    const [paidBySpine, tendersBySpine] = await Promise.all([
        // Links counted from either side, and only while the settling voucher is
        // still alive — so a cancelled receipt stops showing as paid here too.
        sumLinked(prisma, uvIds),
        loadTenderLines(prisma, uvIds),
    ]);
    const creatorIds = [...new Set(rawVouchers.map((v) => v.universalVoucher?.createdById).filter((x): x is number => x != null))];
    const creatorById = new Map(
        (creatorIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }))
            .map((u) => [u.id, u.name]),
    );

    return rawVouchers.map((v) => {
        const partyAccountId = v.universalVoucher?.partyAccountId ?? arAccountId;
        const nonArTenderSum = (v.universalVoucherId !== null ? (tendersBySpine.get(v.universalVoucherId) ?? []) : [])
            .reduce((s, t) => s + (t.accountId === partyAccountId ? 0 : t.amount), 0);
        const jePaid = v.universalVoucherId !== null ? (paidBySpine[v.universalVoucherId] ?? 0) : 0;
        const amountPaid = nonArTenderSum + jePaid;
        return {
            id: v.id,
            reference: v.universalVoucher?.voucherNo ?? "",
            type: v.universalVoucher?.type ?? "",
            status: v.universalVoucher?.status ?? "DRAFT",
            date: v.universalVoucher?.date.toISOString() ?? new Date(0).toISOString(),
            totalAmount: toNumber(v.totalAmount).toFixed(2),
            amountPaid: amountPaid.toFixed(2),
            branch: v.universalVoucher?.branch ?? { name: "" },
            createdBy: v.universalVoucher?.createdById != null
                ? { name: creatorById.get(v.universalVoucher.createdById) ?? "" }
                : { name: "" },
        };
    });
}

function voucherOutstanding(v: TxInvVoucher): number {
    return toNumber(v.totalAmount) - toNumber(v.amountPaid);
}

type PartyFilter = {
    partyType: "customer" | "company";
    partyId: number;
};

export async function loadCustomerTransactionVouchers(
    prisma: PrismaClient,
    account: AccountForOpening | null,
    party: PartyFilter,
    from: Date,
    to: Date,
): Promise<TxInvVoucher[]> {
    if (!account) return [];

    const partyOr = [
        { universalVoucher: { partyAccountId: account.id } },
        { partyType: party.partyType, partyId: party.partyId },
    ] as const;

    const [periodRaw, priorRaw] = await Promise.all([
        prisma.voucherDetail.findMany({
            where: {
                universalVoucher: { deletedAt: null, date: { gte: from, lte: to } },
                OR: [...partyOr],
            },
            select: VOUCHER_SELECT,
            orderBy: { universalVoucher: { date: "desc" } },
        }),
        prisma.voucherDetail.findMany({
            where: {
                universalVoucher: { deletedAt: null, date: { lt: from } },
                OR: [...partyOr],
            },
            select: VOUCHER_SELECT,
        }),
    ]);

    const [periodVouchers, priorVouchers] = await Promise.all([
        enrichVouchers(prisma, periodRaw, account.id),
        enrichVouchers(prisma, priorRaw, account.id),
    ]);

    const priorOutstanding = priorVouchers.reduce((sum, v) => sum + voucherOutstanding(v), 0);
    const periodOpening = signedMasterOpening(account, to) + priorOutstanding;
    const openingRow = buildOpeningVoucherRow(account.id, periodOpening, from);

    return openingRow ? [openingRow, ...periodVouchers] : periodVouchers;
}
