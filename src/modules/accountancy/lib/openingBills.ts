// ── openingBills — bill-wise breakup of a party's opening balance ────────────
//
// An opening balance is what a party owed (or was owed) before the books began.
// Today it is a single number on the master, `Account.openingBalance`, with NO
// GL lines behind it — reports fold it in at display time. That number is
// therefore invisible to Receivables, Payables and bill-wise linking, all three
// of which read GL legs. Money carried over from the old books simply does not
// appear as outstanding, and cannot be settled against.
//
// The fix is to let that one number become the several BILLS it really was, each
// a real `OPENING` voucher on the spine with a party leg. Once it is a voucher it
// is outstanding, ageable, drillable and — the point — linkable, with no new code
// anywhere: every rule in `billLink.ts` reads the party's GL leg and does not care
// what kind of voucher produced it.
//
// ── Why this does not double-count ──────────────────────────────────────────
//
// The scalar layer and the voucher layer coexist PER ACCOUNT, never both at once.
// `aggregateLedger.loadMasterOpenings` only folds in accounts whose
// `openingBalance` is not null, so an account that has moved to bill-wise
// vouchers (scalar nulled) contributes through its GL lines alone.
//
// ── Why there is no counter-leg ─────────────────────────────────────────────
//
// An opening bill is the party's opening balance and nothing else — Tally's
// way: the figure sits on the ledger, touches no other ledger, and whatever the
// openings fail to agree by shows as the computed "Difference in opening
// balances" line on the Trial Balance and Balance Sheet. So the voucher carries
// ONE leg, the party's. (It used to post its other side to Suspense A/c, which
// filled that ledger with a row per party; owner, 2026-10-14: "opening balance
// are just opening balance of the ledger, no counter balance need".)
//
// A one-legged voucher would unbalance any report that counts it as period
// movement, so `aggregateRange` folds OPENING lines into the opening bucket,
// the same as a master opening — the Trial Balance's Debit and Credit columns
// stay equal and its opening plug picks the difference up.

import type { Prisma } from "@/generated/prisma/client";
import { systemBranchId } from "@/shared/lib/org/systemBranch";
import { round2 } from "@/shared/lib/format/moneyInr";
import { indianFyStartYear } from "./voucherRef";
import { ledgerStatusFilterUv } from "./ledgerStatus";
import { resetReconciliation } from "./reconciliation";

/** The voucher type an opening bill is posted as. */
export const OPENING_TYPE = "OPENING";

/** What an unnamed opening bill is called. */
export const DEFAULT_OPENING_REF = "Opening Balance";

const EPS = 0.005;

/** One bill making up an opening balance. */
export type OpeningBillInput = {
    /** Present for a bill already posted; absent for a new one. */
    universalVoucherId?: number;
    /** Bill number as it read on the old books. Cosmetic — defaults to "Opening Balance". */
    ref:    string;
    /** Bill date, for ageing. Defaults to the start of the financial year. */
    date:   string;
    amount: number;
};

export type OpeningBillRow = OpeningBillInput & {
    universalVoucherId: number;
    type:               "DEBIT" | "CREDIT";
    /** How much of it has been settled — a linked opening bill cannot be removed. */
    linked:             number;
};

/** A refusal meant for the user, not a server fault. */
export class OpeningBillError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OpeningBillError";
    }
}

/**
 * 1 April of the current Indian financial year — the default date for an opening
 * bill whose real date nobody recorded. Derived from the same `indianFyStartYear`
 * the voucher numbering already uses, so both agree about which year it is.
 */
export function defaultOpeningDate(): Date {
    return new Date(Date.UTC(indianFyStartYear(), 3, 1));
}

/** ISO yyyy-mm-dd of the above, for form defaults. */
export function defaultOpeningDateIso(): string {
    return defaultOpeningDate().toISOString().slice(0, 10);
}

/** The opening bills currently posted for a party, oldest first. */
export async function loadOpeningBills(
    db: Prisma.TransactionClient,
    accountId: number,
): Promise<OpeningBillRow[]> {
    const vouchers = await db.universalVoucher.findMany({
        where:  { type: OPENING_TYPE, partyAccountId: accountId, ...ledgerStatusFilterUv() },
        select: {
            id: true, voucherNo: true, date: true,
            lines: { select: { accountId: true, type: true, amount: true } },
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    if (vouchers.length === 0) return [];

    const { sumLinked } = await import("./billLink");
    const linked = await sumLinked(db, vouchers.map((v) => v.id));

    return vouchers.map((v) => {
        const leg = v.lines.find((l) => l.accountId === accountId);
        return {
            universalVoucherId: v.id,
            ref:    v.voucherNo ?? DEFAULT_OPENING_REF,
            date:   v.date.toISOString().slice(0, 10),
            amount: leg ? Number(leg.amount) : 0,
            type:   (leg?.type ?? "DEBIT") as "DEBIT" | "CREDIT",
            linked: linked[v.id] ?? 0,
        };
    });
}

/**
 * Replace a party's opening bills with exactly `bills`, and move the account off
 * the scalar opening in the same breath.
 *
 * `type` applies to every bill, because an opening balance is one side of the
 * book — the same single side the master figure always had. A party who both
 * owes and is owed records the other direction through a normal voucher, not by
 * mixing sides inside one opening.
 *
 * Refuses to remove a bill that something has already been settled against —
 * deleting it would silently un-settle a receipt that has been banked.
 */
export async function saveOpeningBills(
    tx: Prisma.TransactionClient,
    args: {
        accountId: number;
        type:      "DEBIT" | "CREDIT";
        bills:     OpeningBillInput[];
        userId:    number;
    },
): Promise<{ created: number[]; removed: number[]; total: number }> {
    const bills = args.bills
        .map((b) => ({ ...b, amount: round2(b.amount) }))
        .filter((b) => b.amount > EPS);

    const account = await tx.account.findUnique({
        where:  { id: args.accountId },
        select: { id: true, name: true, openingBalance: true, openingBalanceType: true },
    });
    if (!account) throw new OpeningBillError("Ledger not found.");

    // Bill-wise is a PARTY idea. A bank, a cash box or a capital account has an
    // opening balance but no bills behind it — nothing to age, nothing to settle
    // against. Tally gates it the same way ("maintain balances bill-by-bill" is a
    // party-ledger setting). Checked here and not only in the UI, because a
    // hidden button is not a rule.
    const { partyLedgerIds } = await import("./accountGroups");
    if (!(await partyLedgerIds()).has(args.accountId)) {
        throw new OpeningBillError(
            `${account.name} is not a party ledger — bill-wise details are only kept for Sundry Debtors and Sundry Creditors.`,
        );
    }

    const existing = await loadOpeningBills(tx, args.accountId);
    const byId = new Map(existing.map((b) => [b.universalVoucherId, b]));
    const keptIds = new Set(bills.map((b) => b.universalVoucherId).filter((id): id is number => id != null));

    // A bill someone has already settled against cannot be dropped — that would
    // silently un-settle a receipt that has been banked.
    const removed = existing.filter((b) => !keptIds.has(b.universalVoucherId));
    const blockedRemove = removed.filter((b) => b.linked > EPS);
    if (blockedRemove.length > 0) {
        throw new OpeningBillError(
            `${blockedRemove.map((b) => b.ref).join(", ")} ${blockedRemove.length === 1 ? "has" : "have"} money settled against ${blockedRemove.length === 1 ? "it" : "them"} — unlink first, then remove.`,
        );
    }
    // The opening as it stands — the scalar plus any bills — to compare with
    // the bills being saved. Only a change in that total is an opening change.
    const signed = (amount: number, type: "DEBIT" | "CREDIT" | null) => (type === "CREDIT" ? -amount : amount);
    const openingBefore = (account.openingBalance != null && account.openingBalanceType
        ? signed(Number(account.openingBalance), account.openingBalanceType) : 0)
        + existing.reduce((s, b) => s + signed(b.amount, b.type), 0);
    if (removed.length > 0) {
        const ids = removed.map((b) => b.universalVoucherId);
        // Balances first: these postings are being withdrawn.
        await reverseOpeningBalances(tx, ids);
        await tx.universalVoucher.deleteMany({ where: { id: { in: ids } } });
    }

    // Kept bills: the number and the date are free to correct at any time; the
    // AMOUNT may not fall below what has already been settled against it.
    for (const b of bills) {
        if (b.universalVoucherId == null) continue;
        const was = byId.get(b.universalVoucherId);
        if (!was) throw new OpeningBillError("That opening bill no longer exists — reopen the breakup and try again.");
        if (b.amount + 0.01 < was.linked) {
            throw new OpeningBillError(
                `${was.ref} already has ₹${was.linked.toFixed(2)} settled against it, so it cannot be reduced to ₹${b.amount.toFixed(2)}.`,
            );
        }
        await tx.universalVoucher.update({
            where: { id: b.universalVoucherId },
            data:  { voucherNo: b.ref.trim() || DEFAULT_OPENING_REF, date: new Date(`${b.date}T00:00:00.000Z`) },
        });
        if (Math.abs(b.amount - was.amount) > EPS || was.type !== args.type) {
            await reverseOpeningBalances(tx, [b.universalVoucherId]);
            await tx.voucherGlLine.deleteMany({ where: { universalVoucherId: b.universalVoucherId } });
            await tx.voucherGlLine.create({
                data: { universalVoucherId: b.universalVoucherId, accountId: args.accountId, type: args.type, amount: b.amount, seq: 0 },
            });
            await applyOpeningBalances(tx, [b.universalVoucherId]);
        }
    }

    const created: number[] = [];
    for (const b of bills) {
        if (b.universalVoucherId != null) continue;
        const uv = await tx.universalVoucher.create({
            data: {
                type:           OPENING_TYPE,
                date:           new Date(`${b.date}T00:00:00.000Z`),
                description:    `Opening balance — ${account.name}`,
                voucherNo:      b.ref.trim() || DEFAULT_OPENING_REF,
                status:         "POSTED",
                postedAt:       new Date(),
                partyAccountId: args.accountId,
                // An opening balance belongs to the books as a whole, so it is
                // booked at Head Office — there is no counter and no picker on
                // this path. This create is exactly what left 66 OPENING rows
                // branch-less before the column was made required.
                branchId:       await systemBranchId(tx),
                createdById:    args.userId,
            },
            select: { id: true },
        });
        // The party's leg only — see "Why there is no counter-leg" above.
        await tx.voucherGlLine.create({
            data: { universalVoucherId: uv.id, accountId: args.accountId, type: args.type, amount: b.amount, seq: 0 },
        });
        created.push(uv.id);
    }

    await applyOpeningBalances(tx, created);

    // The account now carries its opening through vouchers, so the scalar must
    // go — leaving both would count the same money twice in every report.
    await tx.account.update({
        where: { id: args.accountId },
        data:  { openingBalance: null, openingBalanceType: null, openingBalanceDate: null },
    });

    // A changed opening reaches every day the ledger has — its reconciliation
    // starts over. Re-splitting the same total into bills (or converting the
    // scalar) changes nothing.
    const openingAfter = bills.reduce((s, b) => s + signed(b.amount, args.type), 0);
    if (Math.abs(openingAfter - openingBefore) > EPS) {
        await resetReconciliation(tx, [args.accountId]);
    }

    return {
        created,
        removed: removed.map((b) => b.universalVoucherId),
        total:   round2(bills.reduce((s, b) => s + b.amount, 0)),
    };
}

/** Apply the cached `Account.balance` delta for the given vouchers' legs. */
async function applyOpeningBalances(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
    await shiftBalances(tx, ids, 1);
}

/** Take those deltas back out again. */
async function reverseOpeningBalances(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
    await shiftBalances(tx, ids, -1);
}

/**
 * Move `Account.balance` by each leg of the given vouchers, in `sign` direction.
 *
 * `Account.balance` is a movement-only cache that every posting keeps current, so
 * an opening that is now a real posting has to be in it — which is also why the
 * conversion changes what the POS credit check sees, and why that was measured
 * before any of it ran (`pnpm opening:preview`).
 */
async function shiftBalances(tx: Prisma.TransactionClient, ids: number[], sign: 1 | -1): Promise<void> {
    if (ids.length === 0) return;
    const lines = await tx.voucherGlLine.findMany({
        where:  { universalVoucherId: { in: ids } },
        select: { accountId: true, type: true, amount: true },
    });
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await tx.account.findMany({
        where:  { id: { in: accountIds } },
        select: { id: true, normalBalance: true, group: { select: { type: true } } },
    });
    const nbById = new Map(accounts.map((a) => [
        a.id,
        a.normalBalance ?? (a.group?.type === "ASSET" || a.group?.type === "EXPENSE" ? "DEBIT" as const : "CREDIT" as const),
    ]));

    const delta = new Map<number, number>();
    for (const l of lines) {
        const nb = nbById.get(l.accountId);
        if (!nb) continue;
        const d = (nb === l.type ? 1 : -1) * Number(l.amount) * sign;
        delta.set(l.accountId, round2((delta.get(l.accountId) ?? 0) + d));
    }
    for (const [accountId, d] of delta) {
        if (Math.abs(d) < EPS) continue;
        await tx.account.update({ where: { id: accountId }, data: { balance: { increment: d } } });
    }
}
