import { businessToday, startOfDayUtc, businessTodayIso } from "@/shared/lib/format/formatDate";
import { round2 } from "@/shared/lib/format/moneyInr";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { readCounterSetup } from "@/shared/lib/counter/releaseGuard";
import { sourceCounterNumber } from "@/shared/lib/counter/sourceCounter";

export type LineForBalance = {
    type: "DEBIT" | "CREDIT";
    amount: { toString(): string } | number | string;
};

export function toNumber(v: { toString(): string } | number | string): number {
    return typeof v === "number" ? v : Number(v);
}

/** What one line adds to its account's balance, signed toward the account's normal side. */
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
    // Read first: Prisma runs an upsert with nothing to update as three reads.
    const config = await tx.booksConfig.findUnique({ where: { id: 1 } })
        ?? await tx.booksConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

    // The format lives on the kind's row; the NUMBER lives on this counter's row.
    const current = await tx.voucherSeries.findUnique({ where: { kind } });
    if (!current) {
        throw new Error(`VoucherSeries for kind '${kind}' not found. Visit Settings → Year Ending to initialise.`);
    }

    const counterNumber = await numberingCounter(tx, ctx);
    const key = { kind_counterNumber: { kind, counterNumber } };

    // One row per (kind, counter); a counter's first voucher starts its run at
    // `startFrom`. (Counter 1's running number moved here from the series row in B3b.)
    const row = await tx.voucherSeriesCounter.findUnique({ where: key }) ?? await tx.voucherSeriesCounter.upsert({
        where: key,
        create: {
            kind,
            counterNumber,
            nextSeq: 0,
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

    // The series row carries the office's financial year for the Year Ending page;
    // only the office writes it.
    if (counterNumber === 1 && advanced.fyStartYear !== current.fyStartYear) {
        await tx.voucherSeries.update({
            where: { kind },
            data: { fyStartYear: advanced.fyStartYear },
        });
    }

    return assembleReference(
        { ...current, nextSeq: advanced.nextSeq, fyStartYear: advanced.fyStartYear ?? current.fyStartYear },
        counterNumber,
    );
}

