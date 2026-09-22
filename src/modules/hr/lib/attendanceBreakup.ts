// How a day is arrived at, shown as the arithmetic rather than as a verdict.
//
// Owner, 2026-09-22: *"how the day is calculated, hour breakup user wise day
// wise."* Pure, so the API, the register's day panel and the month sheet all
// answer the same way — and so the working can be checked without a database.

import type { DutyGrade } from "@/shared/lib/hr/dutyTime";
import { gradeDay, overtimeMinutes, shortMinutes } from "@/shared/lib/hr/dutyTime";

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
    overtimeMinutes: number;
    shortMinutes: number;
    /** What the minutes grade to, and what the day actually reads as. */
    grade: DutyGrade;
    status: string;
    /** True when the office typed the status and the clock was overruled. */
    manual: boolean;
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
    status: string;
    manual: boolean;
}): DayBreakup {
    const spans = input.spans
        .map((s) => resolveOpenSpan(s, input.lastSeenAt, input.isToday))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return {
        date: input.date,
        tracked: input.tracked,
        spans,
        activeCount: spans.length,
        workedMinutes: input.workedMinutes,
        dutyMinutes: input.dutyMinutes,
        idleMinutes: idleBetween(spans),
        lateBy: input.lateBy,
        overtimeMinutes: overtimeMinutes(input.workedMinutes, input.dutyMinutes),
        shortMinutes: shortMinutes(input.workedMinutes, input.dutyMinutes),
        grade: gradeDay(input.workedMinutes, input.dutyMinutes),
        status: input.status,
        manual: input.manual,
    };
}

/** Month totals for the sheet's foot — the same fields, added straight up. */
export function totalBreakup(days: readonly DayBreakup[]) {
    const t = { days: 0, activeCount: 0, worked: 0, duty: 0, idle: 0, late: 0, overtime: 0, short: 0, lateDays: 0 };
    for (const d of days) {
        if (!d.tracked) continue;
        t.days++;
        t.activeCount += d.activeCount;
        t.worked      += d.workedMinutes;
        t.duty        += d.dutyMinutes;
        t.idle        += d.idleMinutes;
        t.late        += d.lateBy;
        t.overtime    += d.overtimeMinutes;
        t.short       += d.shortMinutes;
        if (d.lateBy > 0) t.lateDays++;
    }
    return t;
}
