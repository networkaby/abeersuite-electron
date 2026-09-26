import { defaultNormalBalanceForGroupType } from "./groupNature";
import { dateOnOrBefore, businessToday, startOfDayUtc, businessTodayIso } from "@/shared/lib/format/formatDate";
import { round2 } from "@/shared/lib/format/moneyInr";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { readCounterSetup } from "@/shared/lib/counter/releaseGuard";
import { sourceCounterNumber } from "@/shared/lib/counter/sourceCounter";

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
 * the master opening balance folded in at read time.
 *
 * ── Use this only for a WHOLE-chart listing ────────────────────────────────
 * Every surface that shows a KNOWN, BOUNDED set of accounts now sums the GL
 * lines instead — `closingForAccounts` in `aggregateLedger`. Since each counter
 * carries a full local replica, a narrowed aggregate is an indexed local read,
 * and a figure that cannot drift beats a figure that is slightly cheaper. The
 * credit gate, the POS customer panel, the party lists and the party-delete
 * guard all went that way; `tillBalancesPaise` got there first.
 *
 * What is left here is the ledgers list — the entire chart of accounts at once,
 * where summing means a full-ledger scan on every request. That is the one case
 * where the cache still earns its place. `closingFromCache` is its equivalent
 * for the finance top bar.
 *
 * So: bounded set of accounts → `closingForAccounts`. Every account → this, or
 * `closingFromCache`. Reports that must be provably-from-truth →
 * `aggregateClosingAsOf` with no `accountIds`.
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

/**
 * Debits minus credits, in whole paise, judged on each line AS STORED — rounded
 * to 2dp one line at a time, exactly as `glLineRow` writes it. A raw float sum
 * can call a voucher level while its rounded legs land a paisa apart, and a
 * paisa off in one voucher is "Difference in opening balances ₹0.01" on every
 * Balance Sheet after it (SV-930802-26, 17 Sep 2026).
 */
export function glGapPaise(lines: LineForBalance[]): number {
    let paise = 0;
    for (const l of lines) {
        const p = Math.round(round2(toNumber(l.amount)) * 100);
        paise += l.type === "DEBIT" ? p : -p;
    }
    return paise;
}

/** True when the stored debits equal the stored credits to the paisa. */
export function isBalanced(lines: LineForBalance[]): boolean {
    return glGapPaise(lines) === 0;
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
 * Which counter this save numbers under — THE one rule, for every voucher kind.
 *
 * The COUNTER THE BILL IS RAISED AT decides, on every write mode (owner's call,
 * 2026-09-25 — it reverses the 2026-09-20 "machine that writes" rule):
 *   • a till writing to its own replica numbers under its own counter;
 *   • a `v_live` till's relayed sale numbers under THAT till, read from the
 *     `x-abeer-counter-number` header the relay stamps (sourceCounter.ts);
 *   • the office itself, and anything with no counter, numbers as counter 1.
 * It is the same resolution that stamps `sourceCounterId`, so a voucher's number
 * and its provenance always name the same counter.
 *
 * Two machines can now write one till's `VoucherSeriesCounter` row — the till while
 * it writes locally, the office for its relayed sales. Sync keeps the higher number
 * when the till pushes (`mergeSeriesCounter` in sync/push.ts), and pull hands the
 * till the office's newer copy.
 *
 * `ctx` survives for the callers that ask about a named counter (the next-ref
 * previews). `resolveCounterNumber` is the synchronous half — explicit, else this
 * PC's own setup, else 1 — for those GET previews, which a till never relays.
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

/** The counter a WRITE numbers under: explicit, else the relayed/own counter, else 1. */
export async function numberingCounter(
    tx: import("@/generated/prisma/client").Prisma.TransactionClient,
    ctx?: import("./voucherRef").ReferenceContext,
): Promise<number> {
    const explicit = typeof ctx === "number" ? ctx : ctx?.counterNumber ?? null;
    if (explicit != null && explicit > 0) return explicit;
    return (await sourceCounterNumber(tx)) ?? 1;
}

export async function nextRefFromSeries(
    tx: import("@/generated/prisma/client").Prisma.TransactionClient,
    kind: string,
    ctx?: import("./voucherRef").ReferenceContext,
    // The date the NUMBER belongs to — the voucher's own date, not the wall
    // clock. Since a voucher takes its number when it POSTS, a draft dated
    // 25 March and posted on 2 April would otherwise roll the series into the
    // new financial year and hand a 2025-26 voucher a 2026-27 number. Omit it
    // and the series rolls on the shop's today, as it always did.
    opts?: { date?: Date | null },
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

    const counterNumber = await numberingCounter(tx, ctx);
    const key = { kind_counterNumber: { kind, counterNumber } };

    // One row per (kind, counter). Counter 1 (the office) inherits the legacy `VoucherSeries.nextSeq` the first time so numbering
    // continues; every other counter starts its own run at `startFrom`.
    const row = await tx.voucherSeriesCounter.upsert({
        where: key,
        create: {
            kind,
            counterNumber,
            nextSeq: counterNumber === 1 ? current.nextSeq : 0,
            fyStartYear: current.fyStartYear,
            // A fresh row has nothing to reset: it is born at the current generation.
            resetGen: current.resetGen,
        },
        update: {},
    });

    // Compare CALENDAR DAYS, not instants. `fyClosingDate` returns UTC midnight
    // of the last day of the FY, so an instant-valued "today" tested `>` the
    // moment the clock passed 00:00 UTC — i.e. the series rolled into the new
    // financial year during 31 March itself (06:00 IST), numbering that day's
    // vouchers under the wrong FY. `businessToday()` is UTC midnight of the
    // SHOP's day, so 31 Mar is not > 31 Mar and the roll happens on 1 April.
    // The day the series is judged against: the voucher's own date when the
    // caller knows it, else the shop's today. This stops a March-dated voucher
    // from ROLLING the series when it is posted in April. It cannot un-roll one:
    // a series is a single running counter, so once an April voucher has moved it
    // into the new FY, a March voucher posted after that still numbers from the
    // new year. Numbering old-year vouchers means posting them before the roll.
    const today = opts?.date ? startOfDayUtc(businessTodayIso(opts.date)) : businessToday();
    const fyStartYear = row.fyStartYear ?? current.fyStartYear;
    const restart: { fyStartYear?: number; resetGen?: number } = {};
    if (fyStartYear != null) {
        const closing = fyClosingDate(fyStartYear, config.restartMonth, config.restartDay);
        if (today > closing) restart.fyStartYear = fyStartYear + 1;
    }
    // The office's "Reset Counter" is an intent on the series row, not a write to this
    // one: it bumps `VoucherSeries.resetGen` and only THIS counter zeroes its own row,
    // here, the next time it numbers. A till that was offline through the reset keeps
    // every increment it queued and restarts when it next bills — nothing the office
    // wrote can land on top of its unpushed row.
    if (row.resetGen < current.resetGen) restart.resetGen = current.resetGen;
    if (Object.keys(restart).length > 0) {
        await tx.voucherSeriesCounter.update({
            where: key,
            data: { ...restart, nextSeq: 0 },
        });
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

