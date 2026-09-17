import type { PrismaClient } from "@/generated/prisma/client";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { defaultNormalBalanceForGroupType, type GroupTypeStr } from "@/modules/accountancy/lib/groupNature";
import { ledgerStatusFilterUv } from "@/modules/accountancy/lib/ledgerStatus";
import { voucherSourceForType, type VoucherSource } from "@/modules/accountancy/lib/voucherUrls";
import { settlementOf, sumLinked } from "@/modules/accountancy/lib/billLink";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import type { TxInvVoucher } from "@/modules/customer/components/TransactionsTable";

// The party's Transactions tab — their bills AND the money that came in
// against them, as one running ledger.
//
// `movement` is what a row does to the balance, and it is read off the party's
// OWN GL legs, never off the bill's tender rows. That distinction is the whole
// fix: an imported voucher carries no tender rows at all, so the older reading
// (total − role=TENDER legs) called every imported cash sale unpaid and the
// balance could only ever climb. A leg is a leg whoever wrote it, so this
// reading closes on the same figure as the ledger report, the party list badge
// and the trial balance.
//
//   cash bill       no leg on the party  → movement 0, Paid = the full total
//   credit bill     Dr for the whole    → movement +total, Paid 0
//   part-paid bill  Dr for the balance  → movement +that, Paid = the rest
//   receipt         Cr                  → movement −amount
//
// Receipts, payments and credit notes have no VoucherDetail row, so they can
// only be found through their GL legs — which is why they were missing from
// this tab altogether before.
//
// `settlement` answers a DIFFERENT question from `movement`, and deliberately
// so. Movement is what the party's ledger says they owe. Settlement is what
// VoucherAllocation says the money was pointed AT — whether this bill has been
// matched off against a receipt, bill by bill. A party can be square on the
// ledger and still have every bill sitting unmatched, which is exactly the
// state this tab now shows instead of hiding.
//
// Only POSTED vouchers are listed at all: a draft or cancelled voucher is not
// part of a money statement, so there is no status left worth a column of its
// own — the Status column carries the settlement instead.

const VOUCHER_SELECT = {
    id: true,
    totalAmount: true,
    universalVoucherId: true,
    universalVoucher: {
        select: {
            createdById: true,
            partyAccountId: true,
            voucherNo: true,
            date: true,
            type: true,
            branch: { select: { name: true } },
        },
    },
} as const;

/** One leg on the party's ledger, carrying the spine header the money rows need. */
const LEG_SELECT = {
    type: true,
    amount: true,
    universalVoucherId: true,
    universalVoucher: {
        select: {
            id: true,
            type: true,
            voucherNo: true,
            date: true,
            createdById: true,
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
        date: Date;
        type: string;
        branch: { name: string } | null;
    } | null;
};

type SpineHeader = {
    id: number;
    type: string;
    voucherNo: string | null;
    date: Date;
    createdById: number | null;
    branch: { name: string } | null;
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

/** The account's normal side, resolved the way the posting engine does. */
function normalSideOf(account: AccountForOpening): "DEBIT" | "CREDIT" {
    return account.normalBalance
        ?? (account.group?.type ? defaultNormalBalanceForGroupType(account.group.type as GroupTypeStr) : "DEBIT");
}

/** Master-page opening balance, signed onto the account's normal side.
 *  Folded in whenever `openingBalanceDate` is on/before `to` — mirrors
 *  aggregateRange's rule in aggregateLedger.ts (folded into the opening
 *  bucket whenever dated <= `to`, regardless of whether that falls before or
 *  inside the period) so the customer Transactions view and the accountancy
 *  reports never disagree about which period an opening balance belongs to. */
export function signedMasterOpening(account: AccountForOpening, to: Date): number {
    if (account.openingBalance == null || !account.openingBalanceType) return 0;
    if (account.openingBalanceDate && account.openingBalanceDate > to) return 0;
    return balanceDelta(normalSideOf(account), account.openingBalanceType, toNumber(account.openingBalance));
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
        rowKey: `opening:${accountId}`,
        id: -accountId,
        universalVoucherId: null,
        source: "inv",
        reference: "Opening balance",
        type: "OPENING",
        date: periodFrom.toISOString(),
        totalAmount: total.toFixed(2),
        amountPaid: paid.toFixed(2),
        movement: signedOpening.toFixed(2),
        // Not a voucher — it is a figure on the master page, and it has to be
        // turned into a real opening bill before anything can be matched to it.
        settlement: null,
        settlementOpen: "0.00",
        branch: { name: "" },
        createdBy: { name: "" },
    };
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

    const nb = normalSideOf(account);
    const partyOr = [
        { universalVoucher: { partyAccountId: account.id } },
        { partyType: party.partyType, partyId: party.partyId },
    ] as const;

    const [billRows, periodLegs, priorAgg] = await Promise.all([
        // The party's own documents — cash bills included, so the tab still
        // lists everything they bought even when it never touched their ledger.
        // Posted only: a draft or cancelled bill is not part of a money statement.
        prisma.voucherDetail.findMany({
            where: {
                universalVoucher: { ...ledgerStatusFilterUv(), date: { gte: from, lte: to } },
                OR: [...partyOr],
            },
            select: VOUCHER_SELECT,
            orderBy: { universalVoucher: { date: "desc" } },
        }),
        // Every posted leg on this party's ledger inside the period.
        prisma.voucherGlLine.findMany({
            where: {
                accountId: account.id,
                universalVoucher: { ...ledgerStatusFilterUv(), date: { gte: from, lte: to } },
            },
            select: LEG_SELECT,
        }),
        // Everything before it, as two sums rather than every historical row.
        prisma.voucherGlLine.groupBy({
            by: ["type"],
            where: {
                accountId: account.id,
                universalVoucher: { ...ledgerStatusFilterUv(), date: { lt: from } },
            },
            _sum: { amount: true },
        }),
    ]);

    // Movement per voucher, signed onto the account's normal side.
    const movementByUv = new Map<number, number>();
    const headerByUv = new Map<number, SpineHeader>();
    for (const leg of periodLegs) {
        const uv = leg.universalVoucher;
        if (!uv) continue;
        movementByUv.set(uv.id, (movementByUv.get(uv.id) ?? 0) + balanceDelta(nb, leg.type, toNumber(leg.amount)));
        headerByUv.set(uv.id, uv);
    }

    const priorMovement = priorAgg.reduce(
        (sum, r) => sum + balanceDelta(nb, r.type, toNumber(r._sum.amount ?? 0)),
        0,
    );

    // How much of each voucher has been matched off bill-wise. Counted from
    // either side and only while the settling voucher is still alive, so a
    // cancelled receipt stops clearing its bill here too.
    const billedUvIds = new Set<number>();
    for (const v of billRows as RawVoucher[]) {
        if (v.universalVoucherId !== null) billedUvIds.add(v.universalVoucherId);
    }
    const linkedBySpine = await sumLinked(prisma, [...billedUvIds, ...movementByUv.keys()]);

    // ── Bill rows ────────────────────────────────────────────────────────────
    const billRowsOut = (billRows as RawVoucher[]).map((v) => {
        const uv = v.universalVoucher;
        const uvId = v.universalVoucherId;
        const total = toNumber(v.totalAmount);
        // What this bill left ON the party's account; the rest was taken at the
        // counter, and that is what "Paid" means here.
        const movement = uvId !== null ? (movementByUv.get(uvId) ?? 0) : 0;
        const settled = settlementOf(movement, uvId !== null ? (linkedBySpine[uvId] ?? 0) : 0);
        return {
            rowKey: `inv:${v.id}`,
            id: v.id,
            universalVoucherId: uvId,
            source: "inv" as VoucherSource,
            reference: uv?.voucherNo ?? "",
            type: uv?.type ?? "",
            date: uv?.date.toISOString() ?? new Date(0).toISOString(),
            totalAmount: total.toFixed(2),
            amountPaid: (total - movement).toFixed(2),
            movement: movement.toFixed(2),
            settlement: settled.state,
            settlementOpen: settled.open.toFixed(2),
            branch: uv?.branch ?? { name: "" },
            createdById: uv?.createdById ?? null,
        };
    });

    // ── Money rows ───────────────────────────────────────────────────────────
    // Receipts, payments, credit / debit notes, journals — every movement on
    // this ledger that is not one of the party's own bills.
    const moneyRowsOut = [...movementByUv.entries()]
        .filter(([uvId]) => !billedUvIds.has(uvId))
        .map(([uvId, movement]) => {
            const uv = headerByUv.get(uvId)!;
            const settled = settlementOf(movement, linkedBySpine[uvId] ?? 0);
            return {
                rowKey: `gl:${uvId}`,
                id: uvId,
                universalVoucherId: uvId,
                source: voucherSourceForType(uv.type),
                reference: uv.voucherNo ?? formatUvNo(uvId),
                type: uv.type,
                date: uv.date.toISOString(),
                totalAmount: (movement > 0 ? movement : 0).toFixed(2),
                amountPaid: (movement < 0 ? -movement : 0).toFixed(2),
                movement: movement.toFixed(2),
                settlement: settled.state,
                settlementOpen: settled.open.toFixed(2),
                branch: uv.branch ?? { name: "" },
                createdById: uv.createdById,
            };
        });

    // Creator names for both sets in one lookup.
    const merged = [...billRowsOut, ...moneyRowsOut];
    const creatorIds = [...new Set(merged.map((r) => r.createdById).filter((x): x is number => x != null))];
    const creatorById = new Map(
        (creatorIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }))
            .map((u) => [u.id, u.name]),
    );

    const rows: TxInvVoucher[] = merged
        .sort((a, b) => +new Date(b.date) - +new Date(a.date))
        .map(({ createdById, ...r }) => ({
            ...r,
            createdBy: { name: createdById != null ? (creatorById.get(createdById) ?? "") : "" },
        }));

    const openingRow = buildOpeningVoucherRow(account.id, signedMasterOpening(account, to) + priorMovement, from);
    return openingRow ? [openingRow, ...rows] : rows;
}
