// How a day is arrived at, shown as the arithmetic rather than as a verdict.
//
// Owner, 2026-09-22: *"how the day is calculated, hour breakup user wise day
// wise."* Pure, so the API, the register's day panel and the month sheet all
// answer the same way — and so the working can be checked without a database.

import type { DutyGrade } from "@/shared/lib/hr/dutyTime";
import { earlyMinutes, gradeDay, overtimeMinutes, shortMinutes } from "@/shared/lib/hr/dutyTime";
import type { AttendanceEffect, PayRules } from "@/shared/lib/hr/payRules";
import type { AttendanceReview } from "@/shared/lib/hr/attendanceReview";
import type { PayslipAttendanceData, PayslipAttendanceDay } from "@/shared/components/print/PayslipBody";

/** One active stretch, as the screens want it: ISO instants, minutes, why it ended. */
export interface SpanDto {
    startedAt: string;
    /** Null only while the stretch is genuinely still running — see `resolveOpenSpan`. */
    endedAt: string | null;
    minutes: number;
    counterId: number | null;
    endedBy: "OPEN" | "IDLE" | "SIGNED_OUT" | "SHIFT_CLOSED";
}

export interface DayBreakup {
    date: string;
    /**
     * False for any day before the spans were being kept. The screens say "not
     * tracked in detail" rather than showing an honest-looking zero — an invented
     * single stretch would read exactly like a real one, and this number is one
     * people are paid on.
     */
    tracked: boolean;
    spans: SpanDto[];
    /** HOW MANY TIMES they were active. The count the owner asked for. */
    activeCount: number;
    /** Minutes credited — the day row's own total, never re-derived from the spans. */
    workedMinutes: number;
    /** What the day owed, resolved for THAT date (the shop's opening moves). */
    dutyMinutes: number;
    /**
     * Time between one stretch ending and the next beginning — away, mid-day.
     *
     * Deliberately only the gaps BETWEEN stretches: the time before the first
     * arrival is lateness and the time after the last is an early finish, and
     * both already have their own line. Counting them here would charge a person
     * twice for one absence.
     */
    idleMinutes: number;
    /** Minutes past the person's start, grace already allowed. 0 = on time. */
    lateBy: number;
    /**
     * Minutes short of closing when they stopped. 0 when they stayed to the end,
     * and 0 on a day still running — nobody has left yet.
     *
     * A short day and an early finish are different failings and the card has to
     * be able to say which one happened.
     */
    leftEarlyBy: number;
    /** The window this day owed, in shop time — "10:00", "19:00". */
    dutyStart: string;
    dutyEnd: string;
    overtimeMinutes: number;
    shortMinutes: number;
    /** What the minutes grade to, and what the day actually reads as. */
    grade: DutyGrade;
    status: string;
    /** True when the office typed the status and the clock was overruled. */
    manual: boolean;
    /**
     * The owner's decision on a till-measured day — null when there is nothing
     * to decide (an office mark, or no minutes). Only ACCEPTED reaches pay;
     * see `shared/lib/hr/attendanceReview.ts`.
     */
    review: AttendanceReview | null;
    /**
     * The day the shop was shut for this person — their own weekly off, or a
     * holiday that applies to their branch. Hours worked on such a day are not
     * ordinary hours: the pay rules grant them at their own rate, so the card
     * names them rather than burying them in "worked".
     */
    weeklyOff: boolean;
    holidayName: string | null;
    /**
     * What the lateness cost, in minutes of duty, under the rule in force —
     * `lateDutyCutMinutes`, the very function payroll calls. 0 when the style
     * charges money instead of time, when the day was inside the free
     * allowance, or when no penalty is set at all.
     */
    latePenaltyMinutes: number;
    /** What the office typed on the day, when it typed anything. */
    note: string | null;
    /** The kind of leave granted for this day — casual, sick — when one was. */
    leaveKind: string | null;
    /**
     * True once the free late days of the period are used up and THIS late day
     * is one that counts. A late day that is not charged still shows its
     * lateness — the point is that the person can see the allowance being spent
     * rather than discovering it on a payslip.
     */
    lateCharged: boolean;
}

/** Minutes between two ISO instants, never negative. */
function minutesBetween(fromIso: string, toIso: string): number {
    const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
    return ms > 0 ? Math.round(ms / 60000) : 0;
}

/**
 * A stretch left open by a day that simply ended.
 *
 * Nothing stamps a sign-out on the server — the session dies, or the machine is
 * switched off — so yesterday's last stretch is still sitting there with no end
 * time. It did end, of course: at the last sign of life, which the day row knows
 * as `lastSeenAt`. Closing it at read time is the honest answer and costs nothing;
 * the alternative is a register that shows every past day still running.
 *
 * Today's open stretch is left open, because it genuinely is.
 */
export function resolveOpenSpan(span: SpanDto, lastSeenAtIso: string | null, isToday: boolean): SpanDto {
    if (span.endedAt || isToday) return span;
    return { ...span, endedAt: lastSeenAtIso ?? span.startedAt, endedBy: "IDLE" };
}

/** The gaps between one stretch and the next, added up. */
export function idleBetween(spans: readonly SpanDto[]): number {
    let idle = 0;
    for (let i = 1; i < spans.length; i++) {
        const prevEnd = spans[i - 1].endedAt;
        if (prevEnd) idle += minutesBetween(prevEnd, spans[i].startedAt);
    }
    return idle;
}

/**
 * The whole day's working, in one object.
 *
 * `status` is what the day READS as, which is not always what the clock grades:
 * an office mark outranks the measurement, and when it does, `manual` says so and
 * the grade is still reported beside it. Showing both is the point — an override
 * that hides what it overrode is how a dispute becomes unanswerable.
 */
export function buildDayBreakup(input: {
    date: string;
    isToday: boolean;
    tracked: boolean;
    spans: SpanDto[];
    lastSeenAt: string | null;
    workedMinutes: number;
    dutyMinutes: number;
    lateBy: number;
    dutyStart: string;
    dutyEnd: string;
    note: string | null;
    leaveKind: string | null;
    status: string;
    manual: boolean;
    review: AttendanceReview | null;
    weeklyOff: boolean;
    holidayName: string | null;
    latePenaltyMinutes: number;
    lateCharged: boolean;
}): DayBreakup {
    const spans = input.spans
        .map((s) => resolveOpenSpan(s, input.lastSeenAt, input.isToday))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    // The last stretch's end, and only when it really has ended: a day still
    // running has not been left early, it has not been left at all.
    const lastOut = spans.length ? spans[spans.length - 1].endedAt : null;
    return {
        date: input.date,
        tracked: input.tracked,
        spans,
        activeCount: spans.length,
        workedMinutes: input.workedMinutes,
        dutyMinutes: input.dutyMinutes,
        idleMinutes: idleBetween(spans),
        lateBy: input.lateBy,
        leftEarlyBy: earlyMinutes(lastOut, input.dutyEnd) ?? 0,
        dutyStart: input.dutyStart,
        dutyEnd: input.dutyEnd,
        note: input.note,
        leaveKind: input.leaveKind,
        overtimeMinutes: overtimeMinutes(input.workedMinutes, input.dutyMinutes),
        shortMinutes: shortMinutes(input.workedMinutes, input.dutyMinutes),
        grade: gradeDay(input.workedMinutes, input.dutyMinutes),
        status: input.status,
        manual: input.manual,
        review: input.review,
        weeklyOff: input.weeklyOff,
        holidayName: input.holidayName,
        latePenaltyMinutes: input.latePenaltyMinutes,
        lateCharged: input.lateCharged,
    };
}

/**
 * One line of a day's accounting — the minutes, the rate they carry, and what
 * they come to once the rate is applied.
 *
 * Owner, 2026-09-22: *"the time has an allotment % — normal day @1, overtime
 * @1.5, late penalty real late × x = accounted penalty time. After that
 * computation we get the accounted time, then we sum to get the day total."*
 * So every line shows its own working: `minutes × rate = accounted`. A negative
 * `accounted` is time taken back. The label says the rate in words for the
 * styles that are not a plain multiple ("10% of day / 5 min").
 */
export interface AccountLine {
    key: "duty" | "overtime" | "weeklyOff" | "holiday" | "late" | "short";
    label: string;
    /** The raw minutes this line is about — the lateness itself for the late line. */
    minutes: number;
    /** How the rate reads on screen: "× 1.0", "× 2", "10% of day / 5 min", "money". */
    rateLabel: string;
    /** Minutes after the rate, signed. 0 when the line is shown but costs nothing. */
    accounted: number;
    /** Why it is what it is, when a reader would ask. */
    note: string | null;
}

export interface DayAccount {
    lines: AccountLine[];
    /** Every line's `accounted`, summed — the day as if it stood alone. */
    total: number;
}

const times = (n: number) => `× ${Number.isInteger(n) ? `${n}.0` : String(n)}`;

/**
 * The day's accounting, line by line, from the figures payroll itself produced.
 *
 * Nothing is re-measured here: the overtime, the shortfall and the late cut
 * arrive already worked out. This only puts the rate beside each and adds the
 * column up. The total is the day ON ITS OWN — at month end payroll nets the
 * overtime against the short days and the late cuts first, and only what
 * survives meets a rate. The screen says so beside the figure.
 */
export function accountDay(day: DayBreakup, rules: PayRules): DayAccount {
    const lines: AccountLine[] = [];
    const shut = day.weeklyOff || !!day.holidayName;

    if (shut) {
        // A shut day owes nothing: every minute is granted at its own rate and
        // stays outside the netting. Nothing else applies — no lateness against
        // an opening that did not apply, no shortfall against a duty not owed.
        if (day.holidayName) {
            lines.push({
                key: "holiday", label: `Holiday duty (${day.holidayName})`, minutes: day.workedMinutes,
                rateLabel: times(rules.holidayRate), accounted: Math.round(day.workedMinutes * rules.holidayRate),
                note: "paid outside the netting",
            });
        } else {
            lines.push({
                key: "weeklyOff", label: "Weekly-off duty", minutes: day.workedMinutes,
                rateLabel: times(rules.weeklyOffRate), accounted: Math.round(day.workedMinutes * rules.weeklyOffRate),
                note: "paid outside the netting",
            });
        }
        return { lines, total: sum(lines) };
    }

    const normal = Math.min(day.workedMinutes, day.dutyMinutes);
    lines.push({ key: "duty", label: "Normal duty", minutes: normal, rateLabel: times(1), accounted: normal, note: null });

    lines.push({
        key: "overtime", label: "Overtime", minutes: day.overtimeMinutes,
        rateLabel: times(rules.overtimeRate), accounted: Math.round(day.overtimeMinutes * rules.overtimeRate),
        note: day.overtimeMinutes > 0 ? "pays back short days first; only what survives the month is paid" : null,
    });

    lines.push(lateLine(day, rules));

    // A half day has already lost half its duty on the payslip; only the rest is
    // charged here, or the same hour is taken twice (the rule payroll follows).
    const withheld = day.grade === "HALF_DAY" ? Math.round(day.dutyMinutes / 2) : 0;
    const shortCharged = day.grade === "ABSENT" ? 0 : Math.max(0, day.shortMinutes - withheld);
    lines.push({
        key: "short", label: "Short of duty", minutes: day.shortMinutes,
        rateLabel: times(rules.shortHoursRate), accounted: -Math.round(shortCharged * rules.shortHoursRate),
        note: day.grade === "ABSENT" && day.shortMinutes > 0
            ? "the day is paid at zero already — not charged again"
            : withheld > 0
                ? `half the day (${fmtShort(withheld)}) is already withheld on the payslip — only the rest counts`
                : null,
    });

    return { lines, total: sum(lines) };
}

function lateLine(day: DayBreakup, rules: PayRules): AccountLine {
    const base = { key: "late" as const, label: "Late penalty", minutes: day.lateBy };
    if (day.lateBy <= 0) return { ...base, rateLabel: rateOfLate(rules), accounted: 0, note: null };
    if (!day.lateCharged) {
        const n = rules.lateFreeDays;
        return { ...base, rateLabel: rateOfLate(rules), accounted: 0, note: `not charged — inside the first ${n} free late ${n === 1 ? "day" : "days"}` };
    }
    switch (rules.latePenaltyStyle) {
        case "pay":
            return { ...base, rateLabel: "money", accounted: 0, note: `${rules.latePenaltyDays} day${rules.latePenaltyDays === 1 ? "" : "s"} of basic off the payslip, not time` };
        case "none":
            return { ...base, rateLabel: "—", accounted: 0, note: "no late penalty is set" };
        default:
            return { ...base, rateLabel: rateOfLate(rules), accounted: -day.latePenaltyMinutes, note: "charged — the free late days are used up" };
    }
}

/** The late rule as a short label — the multiple, or the slab, or the flat share. */
function rateOfLate(rules: PayRules): string {
    switch (rules.latePenaltyStyle) {
        case "timesLate":    return `× ${rules.lateTimesLate}`;
        case "sharePerSlab": return `${rules.lateSlabPct}% of day / ${rules.lateSlabMinutes} min`;
        case "shareOfDay":   return `${rules.lateSharePct}% of day`;
        case "pay":          return "money";
        default:             return "—";
    }
}

function sum(lines: readonly AccountLine[]): number {
    return lines.reduce((t, l) => t + l.accounted, 0);
}

function fmtShort(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/**
 * The month's accounting in the shape the salary slip freezes.
 *
 * Owner, 2026-09-22: *"also show it in the payslip print."* The slip prints
 * from its own posted line and must say the same thing in ten years, so the
 * days are not read back from the register at print time — they are worked out
 * once here, at generation, and stored beside the pay. Only tracked days are
 * kept: a day the clock never measured has nothing to account, and the slip
 * would otherwise be a page of dashes.
 */
export function freezeAttendanceForPayslip(
    days: readonly DayBreakup[],
    rules: PayRules,
    effect: AttendanceEffect,
): PayslipAttendanceData {
    const out: PayslipAttendanceDay[] = [];
    for (const d of days) {
        if (!d.tracked) continue;
        const acc = accountDay(d, rules);
        const line = (key: AccountLine["key"]) => acc.lines.find((l) => l.key === key);
        const late = line("late");
        const short = line("short");
        const ot = line("overtime");
        const shut = line("holiday") ?? line("weeklyOff");
        out.push({
            date: d.date,
            status: d.status || d.grade,
            shut: d.holidayName ? "HOLIDAY" : d.weeklyOff ? "OFF" : null,
            worked: d.workedMinutes,
            duty: d.dutyMinutes,
            overtime: ot?.minutes ?? 0,
            overtimeAccounted: ot?.accounted ?? 0,
            late: late?.minutes ?? 0,
            lateAccounted: late?.accounted ?? 0,
            short: short?.minutes ?? 0,
            shortAccounted: short?.accounted ?? 0,
            grantedAccounted: shut?.accounted ?? 0,
            total: acc.total,
        });
    }
    const t = totalBreakup(days, rules);
    return {
        days: out,
        workedMinutes: t.worked,
        dutyMinutes: t.duty,
        accountedMinutes: t.accounted,
        payableMinutes: effect.payableMinutes,
        owedMinutes: effect.owedMinutes,
        weeklyOffMinutes: effect.weeklyOffMinutes,
        holidayMinutes: effect.holidayMinutes,
        lateDays: effect.lateDays,
        chargedLateDays: effect.chargedLateDays,
        rates: {
            overtime: rules.overtimeRate,
            shortHours: rules.shortHoursRate,
            weeklyOff: rules.weeklyOffRate,
            holiday: rules.holidayRate,
            late: rateOfLate(rules),
            lateFreeDays: rules.lateFreeDays,
        },
    };
}

/**
 * Month totals for the sheet's foot — the same fields, added straight up.
 * With the rules given, `accounted` is every day's own total summed, before
 * the netting payroll does; without them it stays 0.
 */
export function totalBreakup(days: readonly DayBreakup[], rules?: PayRules) {
    const t = { days: 0, activeCount: 0, worked: 0, duty: 0, idle: 0, late: 0, early: 0, overtime: 0, short: 0, lateDays: 0, latePenalty: 0, chargedLateDays: 0, accounted: 0 };
    for (const d of days) {
        if (!d.tracked) continue;
        if (rules) t.accounted += accountDay(d, rules).total;
        t.days++;
        t.activeCount += d.activeCount;
        t.worked      += d.workedMinutes;
        t.duty        += d.dutyMinutes;
        t.idle        += d.idleMinutes;
        t.late        += d.lateBy;
        t.early       += d.leftEarlyBy;
        t.overtime    += d.overtimeMinutes;
        t.short       += d.shortMinutes;
        if (d.lateBy > 0) t.lateDays++;
        if (d.lateCharged) { t.chargedLateDays++; t.latePenalty += d.latePenaltyMinutes; }
    }
    return t;
}
