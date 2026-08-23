import { defaultNormalBalanceForGroupType } from "./groupNature";
import { dateOnOrBefore, businessToday } from "@/shared/lib/format/formatDate";

export type LineForBalance = {
    type: "DEBIT" | "CREDIT";
    amount: { toString(): string } | number | string;
};

/** Minimal shape of an `Account` (+ group) needed to derive its list-view balance. */
export type AccountForEffectiveBalance = {
    balance: { toString(): string } | number | string;
    normalBalance: "DEBIT" | "CREDIT" | null;
    group: { type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" } | null;
    openingBalance: { toString(): string } | number | string | null;
    openingBalanceType: "DEBIT" | "CREDIT" | null;
    openingBalanceDate: Date | null;
};

/** Prisma `select` fields required to compute `effectiveAccountBalance` — spread
 *  this into any `tillAccount`/`account` select instead of hand-listing the
 *  fields, so every reader of an account's current balance folds in the
 *  master opening the same way (e.g. POS till accounts, which are routinely
 *  opened with a master `openingBalance` instead of a GL voucher). */
export const EFFECTIVE_BALANCE_SELECT_FIELDS = {
    balance:            true,
    normalBalance:      true,
    openingBalance:     true,
    openingBalanceType: true,
    openingBalanceDate: true,
    group:              { select: { type: true } },
} as const;

/**
 * Cheap list-view balance: cached `Account.balance` (GL movements only) plus
 * the master opening balance folded in at read time — same shape used by the
 * ledgers list and the customer/company party lists. For the full GL-truth
 * recompute used by reports, see `aggregateClosingAsOf` instead.
 */
export function effectiveAccountBalance(a: AccountForEffectiveBalance): number {
    const nb = a.normalBalance
        ?? (a.group?.type ? defaultNormalBalanceForGroupType(a.group.type) : "DEBIT");
    let bal = toNumber(a.balance);
    if (a.openingBalance != null && a.openingBalanceType) {
        if (!a.openingBalanceDate || dateOnOrBefore(a.openingBalanceDate, new Date())) {
            bal += balanceDelta(nb, a.openingBalanceType, toNumber(a.openingBalance));
        }
    }
    return bal;
}

export function toNumber(v: { toString(): string } | number | string): number {
    return typeof v === "number" ? v : Number(v);
}

/** Delta to apply to GlAccount.balance when posting a line. */
export function balanceDelta(
    normalBalance: "DEBIT" | "CREDIT",
    entryType: "DEBIT" | "CREDIT",
    amount: number,
): number {
    if (normalBalance === "DEBIT") {
        return entryType === "DEBIT" ? amount : -amount;
    }
    return entryType === "CREDIT" ? amount : -amount;
}

/**
 * Resolve each account's normal side the SAME way the posting engine does:
 * `normalBalance`, else the group's natural side, else null (nature unknown).
 *
 * Use this for every reversal of a cached `Account.balance` (cancel / hard-delete).
 * The engine (`engineGlArm`) applies its delta with the group fallback, so a
 * reversal that reads bare `normalBalance` is NOT its mirror image: the ~25
 * null-`normalBalance` ledgers (Payment Gateway, a Bank current a/c, Unsecured
 * Loans, Suspense…) get incremented on post and then either skipped on reverse
 * (`if (!nb) continue`) or — worse — sign-flipped, because `balanceDelta(null,…)`
 * fails the `=== "DEBIT"` test and silently takes the CREDIT branch. Either way
 * the cache drifts away from the ledger, permanently.
 *
 * One query, and the reverse paths already ran an `account.findMany` here, so
 * routing them through this costs nothing extra.
 */
export async function loadNormalBalances(
    tx: import("@/generated/prisma/client").Prisma.TransactionClient,
    accountIds: number[],
): Promise<Map<number, "DEBIT" | "CREDIT" | null>> {
    const ids = [...new Set(accountIds)];
    const out = new Map<number, "DEBIT" | "CREDIT" | null>();
    if (ids.length === 0) return out;

    const rows = await tx.account.findMany({
        where:  { id: { in: ids } },
        select: { id: true, normalBalance: true, group: { select: { type: true } } },
    });
    for (const r of rows) {
        out.set(
            r.id,
            r.normalBalance
                ?? (r.group?.type ? defaultNormalBalanceForGroupType(r.group.type) : null),
        );
    }
    return out;
}

/** True when sum(debits) === sum(credits) within a rounding tolerance. */
export function isBalanced(lines: LineForBalance[]): boolean {
    let net = 0;
    for (const l of lines) {
        const amt = toNumber(l.amount);
        net += l.type === "DEBIT" ? amt : -amt;
    }
    return Math.abs(net) < 0.005;
}

/** Compute closing balance for an account from a set of lines. */
export function computeBalance(
    normalBalance: "DEBIT" | "CREDIT",
    lines: LineForBalance[],
): number {
    let debits = 0;
    let credits = 0;
    for (const l of lines) {
        const amt = toNumber(l.amount);
        if (l.type === "DEBIT") debits += amt;
        else credits += amt;
    }
    return normalBalance === "DEBIT" ? debits - credits : credits - debits;
}

/**
 * Atomically increment nextSeq for the given kind and return the formatted reference.
 * Must be called inside a prisma.$transaction callback.
 *
 * Behavior:
 *  1. If the year-closing date has passed → advance fyStartYear by 1, push the
 *     closing date forward by 1 year, reset nextSeq to 0.
 *  2. Atomically increment nextSeq.
 *  3. Assemble the reference from configured parts.
 *
 * Throws if the VoucherSeries row is missing — visit Settings → Year Ending.
 */
export async function nextRefFromSeries(
    tx: import("@/generated/prisma/client").Prisma.TransactionClient,
    kind: string,
    userId?: number | null,
    counterCode?: string | null,
): Promise<string> {
    const { assembleReference, fyClosingDate } = await import("./voucherRef");

    // Load the org-level books config (singleton). Auto-create on first call
    // so a fresh install never throws.
    const config = await tx.booksConfig.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
    });

    // Read once to check rollover. We do this BEFORE the atomic increment so
    // that the reset (nextSeq → 0) and the increment can happen together.
    const current = await tx.voucherSeries.findUnique({ where: { kind } });
    if (!current) {
        throw new Error(`VoucherSeries for kind '${kind}' not found. Visit Settings → Year Ending to initialise.`);
    }

    // Compare CALENDAR DAYS, not instants. `fyClosingDate` returns UTC midnight
    // of the last day of the FY, so an instant-valued "today" tested `>` the
    // moment the clock passed 00:00 UTC — i.e. the series rolled into the new
    // financial year during 31 March itself (06:00 IST), numbering that day's
    // vouchers under the wrong FY. `businessToday()` is UTC midnight of the
    // SHOP's day, so 31 Mar is not > 31 Mar and the roll happens on 1 April.
    const today = businessToday();
    if (current.fyStartYear != null) {
        const closing = fyClosingDate(current.fyStartYear, config.restartMonth, config.restartDay);
        if (today > closing) {
            await tx.voucherSeries.update({
                where: { kind },
                data: {
                    fyStartYear: current.fyStartYear + 1,
                    nextSeq:     0,
                },
            });
        }
    }

    // Atomic post-increment
    const series = await tx.voucherSeries.update({
        where: { kind },
        data: { nextSeq: { increment: 1 } },
    });

    return assembleReference(series, userId, counterCode);
}

