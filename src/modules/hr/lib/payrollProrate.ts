// Proportioning a monthly salary over a date range.
//
// Owner, 2026-09-20: the payroll sheet shows "the total from last payroll to
// till day", so a run rarely covers a whole month.
//
// Owner, 2026-09-22: *"salary is decided for 26 days as per gvt. rule, now feb
// and January salary will be difference"*. So the day rate is NOT the length of
// the calendar month — it is the revision's own `payDays`, 26 unless a contract
// says otherwise:
//
//     one day  =  that day's pay head amount / payDays
//
// and the period pays for the WORKING days inside it. A weekly off is not paid
// as a day of its own; it is already bought by the 26. On ₹16,000 with Sunday
// off that gives ₹16,000 / 26 = ₹615.38 a day, so January 2026 (27 working
// days) pays ₹16,615 and February (24) pays ₹14,769 — the difference the owner
// described. A month with exactly 26 working days comes back to ₹16,000.
//
// It walks day by day because that is the only version of this that is
// obviously correct: a salary revision landing mid-period, a person joining on
// the 12th and one leaving on the 20th all fall out of the same loop with no
// special case. A year for three hundred people is a few hundred thousand
// additions — far cheaper than the query that fetched them.
//
// Fractions are carried at full precision and rounded ONCE per pay head at the
// end, so twenty-six days of ₹16,000/26 add back to ₹16,000 and not to
// ₹15,999.90.

import type { SalaryLine, SalaryLineKind } from "./salaryLines";
import { DEFAULT_PAY_DAYS } from "@/shared/lib/constants/hr";

export interface ProrateRevision {
    /** Inclusive first day this structure applies. */
    effectiveFrom: string;
    lines: SalaryLine[];
    /** Days a month this structure buys. Falls back to 26 when not set. */
    payDays?: number | null;
}

export interface ProrateInput {
    /** Inclusive period being paid. */
    fromIso: string;
    toIso: string;
    /** Employment window. Null means "no limit on that side". */
    joinedOn: string | null;
    /** Inclusive first day they are NO LONGER employed. */
    leftOn: string | null;
    /** Newest first or oldest first — either; sorted here. */
    revisions: readonly ProrateRevision[];
    /**
     * Weekdays this person does not work — 0 = Sunday … 6 = Saturday, the
     * StaffProfile.weeklyOff convention. They earn nothing of their own, being
     * inside the 26. Empty means every day of the period is a working day.
     */
    weeklyOff?: readonly number[];
    /**
     * ISO date → how much of that day is payable: 0 for a day not paid at all,
     * 0.5 for a half day. A day missing from the map is a normal full day.
     *
     * This is the attendance seam (`attendancePayable.nonPayableDays`). Without
     * it the walk below pays every employed day whether the person came or not,
     * which is fine only while the register is not in daily use — and it is now.
     */
    dayFactors?: ReadonlyMap<string, number>;
}

export interface ProrateResult {
    lines: SalaryLine[];
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    /** WORKING days paid — fractional when a half day falls in the period. */
    paidDays: number;
    /** Days of the period that fell on the person's weekly off. */
    weeklyOffDays: number;
    /** Days in the period itself. */
    periodDays: number;
}

const DAY_MS = 86_400_000;

function utc(iso: string): number {
    return Date.parse(`${iso}T00:00:00.000Z`);
}

function isoOf(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** A stored `payDays` made safe: a missing or silly value falls back to 26. */
export function payDaysOf(v: number | null | undefined): number {
    return typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 31 ? Math.round(v) : DEFAULT_PAY_DAYS;
}

/** 0 = Sunday … 6 = Saturday, for an ISO date. */
export function weekdayOf(iso: string): number {
    return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}

/** Inclusive day count between two ISO dates; 0 when the range is backwards. */
export function inclusiveDays(fromIso: string, toIso: string): number {
    const n = Math.round((utc(toIso) - utc(fromIso)) / DAY_MS) + 1;
    return n > 0 ? n : 0;
}

export function prorate({ fromIso, toIso, joinedOn, leftOn, revisions, weeklyOff = [], dayFactors }: ProrateInput): ProrateResult {
    const periodDays = inclusiveDays(fromIso, toIso);
    const empty: ProrateResult = {
        lines: [], grossPaise: 0, deductionsPaise: 0, netPaise: 0, paidDays: 0, weeklyOffDays: 0, periodDays,
    };
    if (periodDays === 0) return empty;

    // Oldest first, so the scan can keep a cursor instead of searching per day.
    const sorted = [...revisions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    if (sorted.length === 0) return empty;

    // Fractional paise per head, keyed so a head keeps its identity across a
    // revision that renames nothing but changes the amount.
    const acc = new Map<string, { name: string; kind: SalaryLineKind; paise: number }>();
    const offDays = new Set(weeklyOff);
    let paidDays = 0;
    let weeklyOffDays = 0;

    const start = utc(fromIso);
    const end = utc(toIso);
    let cursor = -1; // index of the revision in force

    for (let t = start; t <= end; t += DAY_MS) {
        const day = isoOf(t);

        // Employment window. `leftOn` is the first day they are NOT employed.
        if (joinedOn && day < joinedOn) continue;
        if (leftOn && day >= leftOn) break;

        // Advance to the latest revision effective on or before this day.
        while (cursor + 1 < sorted.length && sorted[cursor + 1].effectiveFrom <= day) cursor += 1;
        if (cursor < 0) continue; // no structure had started yet

        // A weekly off earns nothing on its own — the 26-day rate already paid
        // for it. It is counted separately so the sheet can say so out loud.
        if (offDays.has(weekdayOf(day))) { weeklyOffDays += 1; continue; }

        // What he was actually there for: 1 normally, 0.5 for a half day, 0 for
        // an absence or an unpaid leave. A day nobody marked is a full day.
        const factor = dayFactors?.get(day) ?? 1;
        if (factor <= 0) continue;

        const perDay = payDaysOf(sorted[cursor].payDays);
        for (const l of sorted[cursor].lines) {
            const key = `${l.kind}|${l.name}`;
            const row = acc.get(key) ?? { name: l.name, kind: l.kind, paise: 0 };
            row.paise += (l.amountPaise / perDay) * factor;
            acc.set(key, row);
        }
        paidDays += factor;
    }

    if (paidDays === 0) return { ...empty, weeklyOffDays };

    const lines: SalaryLine[] = [...acc.values()].map((r) => ({
        name: r.name,
        kind: r.kind,
        amountPaise: Math.round(r.paise),
    }));
    let grossPaise = 0, deductionsPaise = 0;
    for (const l of lines) {
        if (l.kind === "EARNING") grossPaise += l.amountPaise;
        else deductionsPaise += l.amountPaise;
    }

    return { lines, grossPaise, deductionsPaise, netPaise: grossPaise - deductionsPaise, paidDays, weeklyOffDays, periodDays };
}

// ── The hourly rate ───────────────────────────────────────────────────────────
//
// Owner, 2026-09-22: *"we have the hourly price from the (monthly salary/26)/
// standard office hour, we sum the hours and then calculate the payment. it's
// not per day."* So extra work is never rounded into days: the month's leftover
// minutes are added up and multiplied by this rate, and two hours twenty is
// 2.33 hours of pay, not half a day.
//
// Fractional paise on purpose — the caller rounds once, at the end, exactly as
// the day walk above does.

/** One day of a monthly figure: amount / payDays. */
export function perDayPaise(amountPaise: number, payDays: number | null | undefined): number {
    return amountPaise / payDaysOf(payDays);
}

/** One hour: a day's pay spread over the duty the person owes in a day. */
export function perHourPaise(amountPaise: number, payDays: number | null | undefined, dutyMinutes: number): number {
    if (!(dutyMinutes > 0)) return 0;
    return perDayPaise(amountPaise, payDays) / (dutyMinutes / 60);
}
