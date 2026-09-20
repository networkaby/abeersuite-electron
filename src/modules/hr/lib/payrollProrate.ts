// Proportioning a monthly salary over a date range.
//
// Owner, 2026-09-20: the payroll sheet shows "the total from last payroll to
// till day", so a run rarely covers a whole month. A monthly structure is
// therefore worth, for each day the person was employed inside the period,
//
//     that day's pay head amount ÷ days in THAT calendar month
//
// which is the ordinary day-basis rule and needs no attendance — only dates.
// Dividing by the real length of each month (28/29/30/31) rather than a flat
// 30 is what makes a full month always come back to exactly the structure's
// figure, in February as much as in January.
//
// It walks day by day because that is the only version of this that is
// obviously correct: a salary revision landing mid-period, a person joining on
// the 12th and one leaving on the 20th all fall out of the same loop with no
// special case. A year for three hundred people is a few hundred thousand
// additions — far cheaper than the query that fetched them.
//
// Fractions are carried at full precision and rounded ONCE per pay head at the
// end, so thirty days of ₹16,000/30 add back to ₹16,000 and not to ₹15,999.90.

import type { SalaryLine, SalaryLineKind } from "./salaryLines";

export interface ProrateRevision {
    /** Inclusive first day this structure applies. */
    effectiveFrom: string;
    lines: SalaryLine[];
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
}

export interface ProrateResult {
    lines: SalaryLine[];
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    /** Days in the period the person was employed and had a structure. */
    paidDays: number;
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

/** Calendar length of the month a day falls in — 28, 29, 30 or 31. */
export function daysInMonthOf(iso: string): number {
    const [y, m] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Inclusive day count between two ISO dates; 0 when the range is backwards. */
export function inclusiveDays(fromIso: string, toIso: string): number {
    const n = Math.round((utc(toIso) - utc(fromIso)) / DAY_MS) + 1;
    return n > 0 ? n : 0;
}

export function prorate({ fromIso, toIso, joinedOn, leftOn, revisions }: ProrateInput): ProrateResult {
    const periodDays = inclusiveDays(fromIso, toIso);
    const empty: ProrateResult = {
        lines: [], grossPaise: 0, deductionsPaise: 0, netPaise: 0, paidDays: 0, periodDays,
    };
    if (periodDays === 0) return empty;

    // Oldest first, so the scan can keep a cursor instead of searching per day.
    const sorted = [...revisions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    if (sorted.length === 0) return empty;

    // Fractional paise per head, keyed so a head keeps its identity across a
    // revision that renames nothing but changes the amount.
    const acc = new Map<string, { name: string; kind: SalaryLineKind; paise: number }>();
    let paidDays = 0;

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

        const perDay = daysInMonthOf(day);
        for (const l of sorted[cursor].lines) {
            const key = `${l.kind}|${l.name}`;
            const row = acc.get(key) ?? { name: l.name, kind: l.kind, paise: 0 };
            row.paise += l.amountPaise / perDay;
            acc.set(key, row);
        }
        paidDays += 1;
    }

    if (paidDays === 0) return empty;

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

    return { lines, grossPaise, deductionsPaise, netPaise: grossPaise - deductionsPaise, paidDays, periodDays };
}
