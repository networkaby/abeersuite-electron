// How a day is arrived at, shown as the arithmetic rather than as a verdict.
//
// Owner, 2026-09-22: *"how the day is calculated, hour breakup user wise day
// wise."* Pure, so the API, the register's day panel and the month sheet all
// answer the same way — and so the working can be checked without a database.

import type { DutyGrade, GradeLimits } from "@/shared/lib/hr/dutyTime";
import { earlyMinutes, gradeDay, lateMinutes, overtimeMinutes, shortMinutes } from "@/shared/lib/hr/dutyTime";
import { pendingTotal, type AttendanceEffect, type PayRules, type PendingDay, type PendingItem } from "@/shared/lib/hr/payRules";
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

/**
 * One line of the day as it was lived, in order. Owner, 2026-10-13: *"full day
 * in the list, on duty, off duty in sequence."*
 *
 *   - `late`  : duty had begun and he had not come yet (duty start to first in)
 *   - `on`    : at the counter. Stretches with a gap inside his idle limit are
 *               one line: a quiet minute, or a sign-out and back, is still duty.
 *   - `off`   : a gap past the idle limit, from his last sign of life to the next.
 *   - `early` : he stopped before duty ended (last sign of life to duty end).
 *
 * `on` + `off` always add up to first in to last out, because the lines are
 * built end to end from the same instants. A `late` line has no `from` instant
 * and an `early` line no `to`; the card prints the duty clock there.
 */
export interface TimelineRow {
    kind: "late" | "on" | "off" | "early";
    from: string | null;
    to: string | null;
    minutes: number;
    /** On an `on` line: still running (today), so its end is "now". */
    open?: boolean;
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
    /** The day in order, on duty and off. See `TimelineRow`. */
    timeline: TimelineRow[];
    /** HOW MANY TIMES they were active. The count the owner asked for. */
    activeCount: number;
    /**
     * Minutes credited — the day row's own total, never re-derived from the
     * spans — or the figure a person corrected it to on the card.
     */
    workedMinutes: number;
    /** What the day owed, resolved for THAT date (the shop's opening moves). */
    dutyMinutes: number;
    /**
     * Time off duty mid-day: the `off` lines of the timeline added up, so the
     * figure and the list can never disagree.
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
     * The till's own figures, before any correction, and which of them a person
     * corrected on the card. The card shows the till's beside a corrected one —
     * an override that hides what it overrode is how a dispute starts.
     * `shared/lib/hr/attendanceSource.ts`.
     */
    till: { workedMinutes: number; lateBy: number };
    corrected: { worked: boolean; late: boolean };
    /** The office's mark kept on the day, also while the day runs on auto. */
    manualStatus: string | null;
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
    /**
     * This day's line of the pending-duty walk (`walkPendingDuty`): duty carried
     * in from earlier days, what today made up, today's overtime, what today
     * added. Null where payroll does not walk the day (before joining).
     */
    pending?: PendingDay | null;
}

/** Minutes between two ISO instants, never negative. */
function minutesBetween(fromIso: string, toIso: string): number {
    const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
    return ms > 0 ? Math.round(ms / 60000) : 0;
}

/**
 * A stretch left open by a day that simply ended.
 *
 * Nothing stamps an end on the server (the session dies, or the machine is
 * switched off), so the last stretch is still sitting there with no end time. It
 * did end, of course: at the last sign of life, which the day row knows as
 * `lastSeenAt`. Closing it at read time is the honest answer and costs nothing.
 *
 * Today's open stretch is left open only while it can still be running. Once
 * the last sign of life is further back than the idle limit he has gone, and it
 * closes there exactly as a past day's does.
 */
export function resolveOpenSpan(
    span: SpanDto, lastSeenAtIso: string | null, isToday: boolean, idleLimitMinutes: number, nowMs = Date.now(),
): SpanDto {
    if (span.endedAt) return span;
    if (isToday && (!lastSeenAtIso || nowMs - new Date(lastSeenAtIso).getTime() <= idleLimitMinutes * 60000)) return span;
    // It ran for the minutes it earned and no further. A stretch is credited
    // beat by beat as it runs, so its own minutes ARE its length; the day's last
    // sign of life only caps it. Ledgers before 2026-10-13 hold stray stretches
    // left open beside the real one — stretching those to the day's last beat
    // painted the whole afternoon as one unbroken line.
    const startMs = new Date(span.startedAt).getTime();
    let endMs = startMs + Math.max(0, span.minutes) * 60000;
    if (lastSeenAtIso) endMs = Math.min(endMs, new Date(lastSeenAtIso).getTime());
    return { ...span, endedAt: new Date(Math.max(startMs, endMs)).toISOString(), endedBy: "IDLE" };
}

type LivedRow = { kind: "on" | "off"; from: string; to: string; minutes: number; open?: boolean };

/**
 * The day as on / off lines, end to end.
 *
 * Stretches are merged wherever the gap to the next is inside the idle limit,
 * and where they overlap (ledgers written before 2026-10-13 can, after two
 * stretches were left open at once). Only a gap past the limit is an `off` line.
 */
export function buildTimeline(spans: readonly SpanDto[], idleLimitMinutes: number, nowIso: string): LivedRow[] {
    const limitMs = idleLimitMinutes * 60000;
    const merged: Array<{ from: string; to: string; open: boolean }> = [];
    for (const s of spans) {
        const to = s.endedAt ?? nowIso;
        const last = merged[merged.length - 1];
        if (last && new Date(s.startedAt).getTime() - new Date(last.to).getTime() <= limitMs) {
            if (to > last.to) last.to = to;
            last.open = last.open || !s.endedAt;
            continue;
        }
        merged.push({ from: s.startedAt, to, open: !s.endedAt });
    }
    const rows: LivedRow[] = [];
    merged.forEach((m, i) => {
        if (i > 0) {
            const prev = merged[i - 1].to;
            rows.push({ kind: "off", from: prev, to: m.from, minutes: minutesBetween(prev, m.from) });
        }
        rows.push({ kind: "on", from: m.from, to: m.to, minutes: minutesBetween(m.from, m.to), ...(m.open ? { open: true } : {}) });
    });
    return rows;
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
    /** The person's own idle limit: what makes a gap an `off` line. */
    idleLimitMinutes: number;
    workedMinutes: number;
    dutyMinutes: number;
    lateBy: number;
    dutyStart: string;
    dutyEnd: string;
    note: string | null;
    leaveKind: string | null;
    status: string;
    manual: boolean;
    till: DayBreakup["till"];
    corrected: DayBreakup["corrected"];
    manualStatus: string | null;
    weeklyOff: boolean;
    holidayName: string | null;
    latePenaltyMinutes: number;
    lateCharged: boolean;
    /** Full / half day bars from Pay Rules. */
    gradeLimits: GradeLimits;
}): DayBreakup {
    const spans = input.spans
        .map((s) => resolveOpenSpan(s, input.lastSeenAt, input.isToday, input.idleLimitMinutes))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const lived = buildTimeline(spans, input.idleLimitMinutes, new Date().toISOString());
    const onLines = lived.filter((r) => r.kind === "on");
    // The day's last end, and only when it really has ended: a day still
    // running has not been left early, it has not been left at all.
    const lastOn = onLines[onLines.length - 1];
    const lastOut = lastOn && !lastOn.open ? lastOn.to : null;
    const shut = input.weeklyOff || !!input.holidayName;
    const leftEarlyBy = earlyMinutes(lastOut, input.dutyEnd) ?? 0;
    // Raw, before any grace: the line shows the time he was not there, which
    // the grace forgives on the charge but does not turn into presence.
    const notYetCome = lived.length && !shut ? lateMinutes(lived[0].from, input.dutyStart, undefined, 0) ?? 0 : 0;
    const timeline: TimelineRow[] = [
        ...(notYetCome > 0 ? [{ kind: "late" as const, from: null, to: lived[0].from, minutes: notYetCome }] : []),
        ...lived,
        ...(!shut && lastOut && leftEarlyBy > 0 ? [{ kind: "early" as const, from: lastOut, to: null, minutes: leftEarlyBy }] : []),
    ];
    return {
        date: input.date,
        tracked: input.tracked,
        spans,
        timeline,
        activeCount: onLines.length,
        workedMinutes: input.workedMinutes,
        dutyMinutes: input.dutyMinutes,
        idleMinutes: lived.reduce((t, r) => t + (r.kind === "off" ? r.minutes : 0), 0),
        lateBy: input.lateBy,
        leftEarlyBy,
        dutyStart: input.dutyStart,
        dutyEnd: input.dutyEnd,
        note: input.note,
        leaveKind: input.leaveKind,
        overtimeMinutes: overtimeMinutes(input.workedMinutes, input.dutyMinutes),
        shortMinutes: shortMinutes(input.workedMinutes, input.dutyMinutes),
        grade: gradeDay(input.workedMinutes, input.dutyMinutes, input.gradeLimits),
        status: input.status,
        manual: input.manual,
        till: input.till,
        corrected: input.corrected,
        manualStatus: input.manualStatus,
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
    key: "pending" | "duty" | "madeUp" | "overtime" | "weeklyOff" | "holiday" | "late" | "short" | "absent";
    label: string;
    /** The raw minutes this line is about — the lateness itself for the late line. */
    minutes: number;
    /** How the rate reads on screen: "× 1.0", "× 2", "10% of day / 5 min", "money". */
    rateLabel: string;
    /** Minutes after the rate, signed. 0 when the line is shown but costs nothing. */
    accounted: number;
    /** Why it is what it is, when a reader would ask. */
    note: string | null;
    /** Minutes this line sends to pending duty instead of taking off the day. */
    toPending?: number;
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
 * column up. Short duty and penalties are shown but not taken off: they go to
 * pending duty, and only what is still pending at month end is cut.
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

    // Owner, 2026-10-13: the day first makes up the duty pending from earlier
    // days; only after nothing is pending is the extra overtime. Every short and
    // every penalty is not taken off the day — it goes to pending, and what is
    // still pending at month end is cut once.
    const p = day.pending;
    const carried = p ? pendingTotal(p.before) : 0;
    const madeUp = p ? p.madeUp : 0;
    const overtime = p ? p.overtime : day.overtimeMinutes;
    const addedOf = (kind: "short" | "late" | "absent") =>
        (p?.added ?? []).filter((a) => a.kind === kind).reduce((t, a) => t + a.minutes, 0);

    lines.push({
        key: "pending", label: "Pending duty (earlier days)", minutes: carried, rateLabel: "", accounted: 0,
        note: p && p.before.length ? pendingBreakup(p.before) : null,
    });

    const normal = Math.min(day.workedMinutes, day.dutyMinutes);
    lines.push({ key: "duty", label: "Normal duty", minutes: normal, rateLabel: times(1), accounted: normal, note: null });

    if (madeUp > 0) {
        const left = pendingTotal(p?.after ?? []);
        lines.push({
            key: "madeUp", label: "Extra → made up pending", minutes: madeUp, rateLabel: times(1), accounted: madeUp,
            note: left > 0 ? `still pending ${fmtShort(left)}` : "nothing pending now",
        });
    }

    lines.push({
        key: "overtime", label: "Overtime", minutes: overtime,
        rateLabel: times(rules.overtimeRate), accounted: Math.round(overtime * rules.overtimeRate),
        note: day.overtimeMinutes > 0 && overtime === 0 ? "the extra went to make up pending duty" : null,
    });

    lines.push(lateLine(day, rules, addedOf("late")));

    const shortAdded = addedOf("short");
    const withheld = day.grade === "HALF_DAY" ? Math.round(day.dutyMinutes / 2) : 0;
    lines.push({
        key: "short", label: "Short of duty", minutes: day.shortMinutes, rateLabel: "", accounted: 0, toPending: shortAdded,
        note: day.grade === "ABSENT" && day.shortMinutes > 0
            ? "the day is paid at zero already — not added to pending"
            : shortAdded > 0
                ? (withheld > 0 ? `half the day (${fmtShort(withheld)}) is already withheld on the payslip — only the rest is pending` : "made up by a later day's extra, or cut at month end")
                : null,
    });

    const absentAdded = addedOf("absent");
    if (absentAdded > 0) {
        lines.push({
            key: "absent", label: "Absence penalty", minutes: absentAdded, rateLabel: "", accounted: 0, toPending: absentAdded,
            note: "absent with no leave granted — the day itself is paid at zero",
        });
    }

    return { lines, total: sum(lines) };
}

function lateLine(day: DayBreakup, rules: PayRules, added: number): AccountLine {
    const base = { key: "late" as const, label: "Late penalty", minutes: day.lateBy };
    if (day.lateBy <= 0) return { ...base, rateLabel: rateOfLate(rules), accounted: 0, note: null };
    if (!day.lateCharged) {
        const n = rules.lateFreeDays;
        return { ...base, rateLabel: rateOfLate(rules), accounted: 0, note: `not charged — inside the first ${n} free late ${n === 1 ? "day" : "days"}` };
    }
    if (rules.latePenaltyStyle === "none") return { ...base, rateLabel: "—", accounted: 0, note: "no late penalty is set" };
    return { ...base, rateLabel: rateOfLate(rules), accounted: 0, toPending: added, note: "charged — the free late days are used up" };
}

/** The late rule as a short label — the multiple, or the slab, or the flat share. */
function rateOfLate(rules: PayRules): string {
    switch (rules.latePenaltyStyle) {
        case "timesLate":    return `× ${rules.lateTimesLate}`;
        case "sharePerSlab": return `${rules.lateSlabPct}% of day / ${rules.lateSlabMinutes} min`;
        case "shareOfDay":   return `${rules.lateSharePct}% of day`;
        case "pay":          return `${rules.latePenaltyDays} day${rules.latePenaltyDays === 1 ? "" : "s"} of duty`;
        default:             return "—";
    }
}

const fmtDate = (iso: string) =>
    new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });

const PENDING_WORD = { short: "short", late: "late penalty", absent: "absence penalty" } as const;

/** "02 Oct short 1h · 03 Oct absence penalty 10h" — the breakup of pending duty. */
export function pendingBreakup(items: readonly PendingItem[]): string {
    return items.map((i) => `${fmtDate(i.date)} ${PENDING_WORD[i.kind]} ${fmtShort(i.minutes)}`).join(" · ");
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
