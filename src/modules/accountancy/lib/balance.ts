import { defaultNormalBalanceForGroupType } from "./groupNature";
import { dateOnOrBefore, businessToday } from "@/shared/lib/format/formatDate";
import { round2 } from "@/shared/lib/format/moneyInr";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { readCounterSetup } from "@/shared/lib/counter/releaseGuard";

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
    balance: true,
    normalBalance: true,
    openingBalance: true,
    openingBalanceType: true,
    openingBalanceDate: true,
    group: { select: { type: true } },
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
        where: { id: { in: ids } },
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

/**
 * Apply — or take back — the cached `Account.balance` deltas for a voucher's GL
 * lines. `"apply"` is what posting does; `"reverse"` is what cancel, park and
 * hard-delete do. Nature resolves exactly as the engine resolved it on the way in
 * (group fallback included), so a null-nature ledger is skipped on BOTH sides and
 * can never drift. One place, so the two directions can never fall out of step.
 */
export async function applyLineBalances(
    tx: import("@/generated/prisma/client").Prisma.TransactionClient,
    lines: { accountId: number; type: "DEBIT" | "CREDIT"; amount: { toString(): string } | number | string }[],
    direction: "apply" | "reverse",
): Promise<void> {
    const nbById = await loadNormalBalances(tx, lines.map((l) => l.accountId));
    for (const line of lines) {
        const nb = nbById.get(line.accountId);
        if (!nb) continue;
        // Round at the money boundary, exactly where the engine rounds
        // (transactionEngine.ts engineGlArm): the stored VoucherGlLine.amount is
        // Decimal(14,2), so an unrounded caller float would move the cached
        // balance by a hair the lines can never account for. A no-op for callers
        // that already hand us 2dp Decimals.
        const delta = balanceDelta(nb, line.type, round2(toNumber(line.amount)));
        await tx.account.update({
            where: { id: line.accountId },
            data:  { balance: direction === "apply" ? { increment: delta } : { decrement: delta } },
        });
    }
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
/**
 * Which counter this save numbers under.
 *
 * An explicit context wins (nothing on the POS path passes one any more — since
 * 2026-09-07 every voucher saved at the office, a relayed one included, numbers in
 * the common series). Otherwise a counter PC numbers under the counter it is set up
 * as, and the office — no counter at all — numbers as counter 1. Same fallback `assembleReference` renders, so the
 * printed reference and the series row it came from always agree.
 */
export function resolveCounterNumber(ctx?: import("./voucherRef").ReferenceContext): number {
    const explicit = typeof ctx === "number" ? ctx : ctx?.counterNumber ?? null;
    if (explicit != null && explicit > 0) return explicit;
    if (IS_COUNTER_PC) {
        const setup = readCounterSetup();
        if (setup && setup.counterNumber > 0) return setup.counterNumber;
    }
    return 1;
}

export async function nextRefFromSeries(
    tx: import("@/generated/prisma/client").Prisma.TransactionClient,
    kind: string,
    ctx?: import("./voucherRef").ReferenceContext,
): Promise<string> {
    const { assembleReference, fyClosingDate } = await import("./voucherRef");

    // Load the org-level books config (singleton). Auto-create on first call
    // so a fresh install never throws.
    const config = await tx.booksConfig.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
    });

    // The format lives on the kind's row; the NUMBER lives on this counter's row.
    const current = await tx.voucherSeries.findUnique({ where: { kind } });
    if (!current) {
        throw new Error(`VoucherSeries for kind '${kind}' not found. Visit Settings → Year Ending to initialise.`);
    }

    const counterNumber = resolveCounterNumber(ctx);
    const key = { kind_counterNumber: { kind, counterNumber } };

    // One row per (kind, counter), so only this machine ever writes it — which is
    // what makes the increment safe under sync's last-write-wins. Counter 1 (the
    // office) inherits the legacy `VoucherSeries.nextSeq` the first time so numbering
    // continues; every other counter starts its own run at `startFrom`.
    const row = await tx.voucherSeriesCounter.upsert({
        where: key,
        create: {
            kind,
            counterNumber,
            nextSeq: counterNumber === 1 ? current.nextSeq : 0,
            fyStartYear: current.fyStartYear,
        },
        update: {},
    });

    // Compare CALENDAR DAYS, not instants. `fyClosingDate` returns UTC midnight
    // of the last day of the FY, so an instant-valued "today" tested `>` the
    // moment the clock passed 00:00 UTC — i.e. the series rolled into the new
    // financial year during 31 March itself (06:00 IST), numbering that day's
    // vouchers under the wrong FY. `businessToday()` is UTC midnight of the
    // SHOP's day, so 31 Mar is not > 31 Mar and the roll happens on 1 April.
    const today = businessToday();
    const fyStartYear = row.fyStartYear ?? current.fyStartYear;
    if (fyStartYear != null) {
        const closing = fyClosingDate(fyStartYear, config.restartMonth, config.restartDay);
        if (today > closing) {
            await tx.voucherSeriesCounter.update({
                where: key,
                data: { fyStartYear: fyStartYear + 1, nextSeq: 0 },
            });
        }
    }

    // Atomic post-increment on this counter's own row.
    const advanced = await tx.voucherSeriesCounter.update({
        where: key,
        data: { nextSeq: { increment: 1 } },
    });

    // The Year Ending page still reads the legacy column for counter 1. Mirrored,
    // not read: allocation never depends on it, and only the office writes it.
    if (counterNumber === 1) {
        await tx.voucherSeries.update({
            where: { kind },
            data: { nextSeq: advanced.nextSeq, fyStartYear: advanced.fyStartYear },
        });
    }

    return assembleReference(
        { ...current, nextSeq: advanced.nextSeq, fyStartYear: advanced.fyStartYear ?? current.fyStartYear },
        counterNumber,
    );
}

