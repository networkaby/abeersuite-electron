import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { effectiveAccountBalance, type AccountForEffectiveBalance } from "@/modules/accountancy/lib/balance";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";

type Tx = Prisma.TransactionClient | PrismaClient;

// ── POS shift cash math ──────────────────────────────────────────────────────
//
// All values in paise (BigInt) to dodge floating-point drift.
//
// The till account IS the drawer's book. A shift opens with the till's book
// balance as its opening float (carry-over + the vault top-up Contra), and every
// movement during the shift — sale cash, receipts, cash refunds, expenditures,
// a manual entry — lands on that same ledger. So at close:
//
//     expected in drawer = till book balance now − Σ mid-shift cash drops
//
// Drops are the one exception: the cash physically left for the safe, but it
// stays on the till ledger until the closing Contra sweeps it. Nothing is
// re-derived per voucher type — the Cash Book and the close read one figure.
//
// Variance is whatever the cashier physically counted vs. what we expect.
// Positive = drawer over (income via Cash Over); negative = short
// (expense via Cash Short).

/** The till's current book balance in paise — the same read shift OPEN uses for
 *  the carry-over, so open and close see the ledger identically. */
export function effectiveBalancePaise(account: AccountForEffectiveBalance): bigint {
    return BigInt(Math.round(effectiveAccountBalance(account) * 100));
}

export function computeExpectedCash(
    tillBookBalancePaise: bigint,
    dropsPaise:           bigint,
): bigint {
    return tillBookBalancePaise - dropsPaise;
}

export function computeVariance(
    declaredCashPaise: bigint,
    expectedCashPaise: bigint,
): bigint {
    return declaredCashPaise - expectedCashPaise;
}

/**
 * Sums a list of payment amounts in paise. Defensive against null/undefined.
 */
export function sumPaise(rows: Array<{ amountPaise: bigint | number | string | null | undefined }>): bigint {
    let total = BigInt(0);
    for (const r of rows) {
        if (r.amountPaise == null) continue;
        total += typeof r.amountPaise === "bigint" ? r.amountPaise : BigInt(r.amountPaise);
    }
    return total;
}

// ── The counter documents a shift carries ────────────────────────────────────
//
// Receipts taken (Rcv) and expenditures paid (Exp), read from the VOUCHERS that
// carry this shift. One reader for the shift detail page, the close report and
// the delete guard, so the three can never disagree about what a shift holds.
//
// Replaced the pos_receipts / pos_expenditures tables (2026-09-13). Those kept
// their own copy of the amount and outlived the voucher when one was deleted, so
// a shift could show ₹500 of expenditure that the till knew nothing about.

export type ShiftMovement = {
    /** The voucher id — the movement IS the voucher now, so this is its identity. */
    id:          number;
    voucherId:   number;
    reference:   string;
    amountPaise: bigint;
    description: string;
    createdAt:   Date;
};

export async function listShiftMovements(
    tx: Tx,
    shiftId: number,
): Promise<{ receipts: ShiftMovement[]; expenditures: ShiftMovement[] }> {
    const vouchers = await tx.universalVoucher.findMany({
        where: {
            type:          { in: ["RECEIPT", "PAYMENT"] },
            status:        "POSTED",
            deletedAt:     null,
            sourceShiftId: shiftId,
        },
        orderBy: { createdAt: "desc" },
        select: {
            id: true, type: true, voucherNo: true, narration: true, description: true, createdAt: true,
            lines: { select: { type: true, amount: true } },
        },
    });
    const shape = (v: (typeof vouchers)[number]): ShiftMovement => ({
        id:          v.id,
        voucherId:   v.id,
        reference:   v.voucherNo ?? formatUvNo(v.id),
        // One side of a balanced voucher is the movement: the tenders on a
        // receipt, the expense leg on an expenditure.
        amountPaise: BigInt(Math.round(
            v.lines.filter((l) => l.type === "DEBIT").reduce((sum, l) => sum + Number(l.amount), 0) * 100,
        )),
        description: v.narration ?? v.description,
        createdAt:   v.createdAt,
    });
    return {
        receipts:     vouchers.filter((v) => v.type === "RECEIPT").map(shape),
        expenditures: vouchers.filter((v) => v.type === "PAYMENT").map(shape),
    };
}

/**
 * Total collected per settlement account during a shift, in paise — for the
 * informational "Payments collected" tally (the reconciliation itself reads the
 * till's book balance, see above). Two sources:
 *
 *   • POS sale tenders (Dr Till / Bank / Wallet …) → the spine's role=TENDER GL
 *     lines of the sales raised on this shift.
 *   • Receipts taken on this shift, read as the DEBIT legs of those spines.
 *
 * Both are found the same way: `UniversalVoucher.sourceShiftId`. Linked, not
 * windowed, so no timestamp can drop a document out of its own shift, and a
 * deleted or cancelled voucher counts for nothing.
 *
 * Returns a Map keyed by accountId; accounts with no activity are absent.
 */
export async function sumShiftTendersByAccount(
    tx: Tx,
    args: {
        shiftId:    number;
        accountIds: number[];
    },
): Promise<Map<number, bigint>> {
    const totals = new Map<number, bigint>();
    if (args.accountIds.length === 0) return totals;
    const toPaise = (amount: { toString(): string } | null): bigint =>
        amount == null ? BigInt(0) : BigInt(Math.round(Number(amount) * 100));
    const add = (accountId: number, paise: bigint) =>
        totals.set(accountId, (totals.get(accountId) ?? BigInt(0)) + paise);

    // POS sales raised ON this shift. Linked by `sourceShiftId`, not windowed by
    // time: a sale saved a second after the shift closed used to fall outside the
    // window and vanish from the tally, and one saved during an overlapping shift
    // on another counter was kept out only because the GL filter below happens to
    // be restricted to this counter's own ledgers. The link decides now.
    const posUvIds = (await tx.universalVoucher.findMany({
        where:  { type: "POS", status: "POSTED", deletedAt: null, sourceShiftId: args.shiftId },
        select: { id: true },
    })).map((v) => v.id);
    const posTenders = posUvIds.length === 0 ? [] : await tx.voucherGlLine.groupBy({
        by:    ["accountId"],
        where: {
            accountId:          { in: args.accountIds },
            role:               "TENDER",
            universalVoucherId: { in: posUvIds },
        },
        _sum:  { amount: true },
    });
    for (const r of posTenders) add(r.accountId, toPaise(r._sum.amount));

    const receiptLines = await tx.voucherGlLine.groupBy({
        by:    ["accountId"],
        where: {
            accountId:        { in: args.accountIds },
            type:             "DEBIT",
            universalVoucher: { type: "RECEIPT", status: "POSTED", deletedAt: null, sourceShiftId: args.shiftId },
        },
        _sum:  { amount: true },
    });
    for (const r of receiptLines) add(r.accountId, toPaise(r._sum.amount));

    return totals;
}

// Counter shape needed to map settlement accounts → method labels. Structurally
// matched by the Prisma counter objects the shift routes already load (cash till
// + the flexible payment-account list).
type CounterRouting = {
    tillAccount:     { id: number };
    paymentAccounts: { channel: string; label: string; accountId: number }[];
};

export type TenderBreakdownRow = { method: string; label: string; amountPaise: string };

/**
 * Per-method tally of everything collected at a counter during a shift, for
 * the close report. CASH routes to the till; each other method uses its
 * per-counter routing account and optional custom label ("PhonePe UPI" etc.).
 * Only methods with a positive total are returned. If two methods share one
 * account, the first in display order claims it (no double-count).
 */
export async function buildShiftTenderBreakdown(
    tx: Tx,
    args: { shiftId: number; counter: CounterRouting },
): Promise<TenderBreakdownRow[]> {
    const c = args.counter;
    const defs: Array<{ method: string; accountId: number | null; label: string }> = [
        { method: "CASH", accountId: c.tillAccount.id, label: "Cash" },
        ...c.paymentAccounts.map((a) => ({ method: a.channel, accountId: a.accountId as number | null, label: a.label?.trim() || a.channel })),
    ];

    const accountIds = [...new Set(defs.map((d) => d.accountId).filter((x): x is number => x != null))];
    const totals = await sumShiftTendersByAccount(tx, { shiftId: args.shiftId, accountIds });

    const claimed = new Set<number>();
    const rows: TenderBreakdownRow[] = [];
    for (const d of defs) {
        if (d.accountId == null || claimed.has(d.accountId)) continue;
        claimed.add(d.accountId);
        const amt = totals.get(d.accountId) ?? BigInt(0);
        if (amt > BigInt(0)) rows.push({ method: d.method, label: d.label, amountPaise: amt.toString() });
    }
    return rows;
}
