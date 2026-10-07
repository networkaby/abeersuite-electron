import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    CUSTOMER_ACCOUNT_OPENING_SELECT,
    loadCustomerTransactionVouchers,
} from "@/modules/customer/lib/customerTransactions";
import { getLedgerOutstanding } from "@/modules/accountancy/lib/outstandings";
import { loadPartyUnallocated } from "@/modules/accountancy/lib/billLink";
import type { PortalAccountOption } from "@/shared/lib/auth/portalAccountContext";

// My Bills (customer portal) — the customer's own statement, read through the
// SAME loaders as the office profile's Transactions and Outstanding tabs, so
// the portal can never show a figure the shop does not. What changes is only
// what leaves the server: no staff names, no branch, no internal narration —
// anything that is not a bill, a payment or a return reads as "Adjustment".
//
// Cached a minute per profile + period: a customer flipping between the three
// tabs, or reloading, does not re-read the ledger each time.

export type PortalStatementRow = {
    key: string;
    /** Spine id — what /portal/b/<id> opens. Null on the opening row. */
    uvId: number | null;
    /** Only bills and receipts have a customer-facing page; the rest has no link. */
    linkable: boolean;
    kind: "bill" | "payment" | "return" | "adjustment" | "opening";
    label: string;
    reference: string;
    date: string;
    total: number;
    paid: number;
    /** Signed: + adds to what they owe, − is money in their favour. */
    movement: number;
    /** Running balance after this row (+ due, − advance). */
    balance: number;
    settlement: "SETTLED" | "PARTIAL" | "DUE" | null;
    open: number;
};

export type PortalStatement = {
    opening: number;
    closing: number;
    rows: PortalStatementRow[];
};

export type PortalOutstanding = {
    bills: { uvId: number | null; reference: string; label: string; billDate: string; total: number; pending: number; days: number }[];
    totalDue: number;
    /** Money received but not yet matched to any bill. */
    advance: number;
    oldestDays: number | null;
};

const TYPE_LABEL: Record<string, { kind: PortalStatementRow["kind"]; label: string }> = {
    SALE: { kind: "bill", label: "Sale" },
    POS: { kind: "bill", label: "Counter sale" },
    SALE_ORDER: { kind: "bill", label: "Order" },
    RECEIPT: { kind: "payment", label: "Payment received" },
    PAYMENT: { kind: "payment", label: "Refund paid" },
    CREDIT_NOTE: { kind: "return", label: "Return / credit note" },
    SALE_RETURN: { kind: "return", label: "Return" },
    OPENING: { kind: "opening", label: "Opening balance" },
};

function labelOf(type: string) {
    return TYPE_LABEL[type] ?? { kind: "adjustment" as const, label: "Adjustment" };
}

function partyOf(option: PortalAccountOption, customerId: number) {
    return option.accountType === "company" && option.companyId != null
        ? { partyType: "company" as const, partyId: option.companyId }
        : { partyType: "customer" as const, partyId: customerId };
}

async function computeStatement(
    accountId: number,
    partyType: "customer" | "company",
    partyId: number,
    fromIso: string,
    toIso: string,
): Promise<PortalStatement> {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: CUSTOMER_ACCOUNT_OPENING_SELECT,
    });
    const raw = await loadCustomerTransactionVouchers(
        prisma, account, { partyType, partyId }, new Date(fromIso), new Date(toIso),
    );

    // Oldest first for the running balance; the opening row (if any) leads.
    const sorted = [...raw].sort((a, b) => {
        if (a.type === "OPENING") return -1;
        if (b.type === "OPENING") return 1;
        return +new Date(a.date) - +new Date(b.date) || a.rowKey.localeCompare(b.rowKey);
    });

    let balance = 0;
    let opening = 0;
    const rows: PortalStatementRow[] = sorted.map((r) => {
        const movement = Number(r.movement);
        balance += movement;
        if (r.type === "OPENING") opening = movement;
        const { kind, label } = labelOf(r.type);
        return {
            key: r.rowKey,
            uvId: r.universalVoucherId,
            linkable: r.universalVoucherId != null && (kind === "bill" || r.type === "RECEIPT"),
            kind,
            label,
            reference: kind === "opening" ? "" : r.reference,
            date: r.date,
            total: Number(r.totalAmount),
            paid: Number(r.amountPaid),
            movement,
            balance,
            settlement: r.settlement,
            open: Number(r.settlementOpen),
        };
    });
    return { opening, closing: balance, rows };
}

async function computeOutstanding(accountId: number, asOfIso: string): Promise<PortalOutstanding> {
    const asOf = new Date(asOfIso);
    const [ledger, unallocated] = await Promise.all([
        getLedgerOutstanding(accountId, asOf),
        loadPartyUnallocated(prisma, [accountId], { asOf }),
    ]);
    // Only the side where the customer owes us — a purchase from them is the
    // shop's business, not theirs to see here.
    const bills = (ledger?.bills ?? [])
        .filter((b) => b.side === 1 && b.outstanding > 0.005)
        .map((b) => ({
            uvId: b.universalVoucherId,
            reference: b.ref,
            label: labelOf(b.voucherType).label,
            billDate: b.billDate,
            total: b.totalAmount,
            pending: b.outstanding,
            days: b.daysOverdue,
        }));
    const totalDue = bills.reduce((s, b) => s + b.pending, 0);
    return {
        bills,
        totalDue,
        advance: unallocated.get(accountId)?.cr ?? 0,
        oldestDays: bills.length ? Math.max(...bills.map((b) => b.days)) : null,
    };
}

const cachedStatement = unstable_cache(computeStatement, ["portal:statement"], { revalidate: 60 });
const cachedOutstanding = unstable_cache(computeOutstanding, ["portal:outstanding"], { revalidate: 60 });

export function loadPortalStatement(option: PortalAccountOption, customerId: number, from: Date, to: Date) {
    const { partyType, partyId } = partyOf(option, customerId);
    return cachedStatement(option.accountId, partyType, partyId, from.toISOString(), to.toISOString());
}

export function loadPortalOutstanding(option: PortalAccountOption, asOf: Date) {
    return cachedOutstanding(option.accountId, asOf.toISOString());
}
