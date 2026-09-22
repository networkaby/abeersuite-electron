// What a day reads as when nobody marked it, and the small date arithmetic the
// register needs. Pure — shared by the API and the grid.

import type { AttendanceStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import type { RegisterPerson } from "./attendanceTypes";
import { dutyHoursFor, dutyMinutesFor, gradeDay, lateMinutes } from "@/shared/lib/hr/dutyTime";
import { shopDateFromIso } from "@/shared/lib/hr/seasonalHours";

/**
 * What this person owed on THAT day — not what they owe today.
 *
 * The shop's opening moves through the year while its closing does not, so a
 * December day is genuinely shorter than a June one and the 75%/40% grading lines
 * move with it. Resolving per day is what stops a winter month reading as a
 * fortnight of half days. Somebody with office hours of their own resolves to the
 * same figure on every date, which is the point of having set them.
 */
export function dutyOn(person: RegisterPerson, iso: string): { start: string; end: string; minutes: number } {
    const hours = dutyHoursFor(person.ownDutyStart, person.ownDutyEnd, {
        on: shopDateFromIso(iso),
        seasonal: person.seasonal,
    });
    return { ...hours, minutes: dutyMinutesFor(person.ownDutyMinutes, hours.start, hours.end) };
}

/** ISO dates from `from` to `to`, inclusive. */
export function isoDaysBetween(from: string, to: string): string[] {
    const out: string[] = [];
    const d = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    while (d.getTime() <= end.getTime()) {
        out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
}

export function weekdayOf(iso: string): number {
    return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}

export function monthBounds(year: number, month: number): { from: string; to: string } {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, "0");
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

export type DayReading =
    | { kind: "outside" }                                   // before joining / after leaving
    | { kind: "unmarked" }
    | {
        kind: "marked";
        status: AttendanceStatus;
        stored: boolean;
        source?: "COUNTER" | "OFFICE";
        /** Minutes worked, when the till measured them — for the cell's tooltip. */
        workedMinutes?: number;
        /** True when the status was worked out from those minutes rather than typed. */
        graded?: boolean;
        /** Minutes past the person's start time, grace already allowed. 0 = on time. */
        lateBy?: number;
    };

/**
 * A stored mark wins. Otherwise the calendar answers: holiday, then approved
 * leave, then weekly off. Before the joining date or after the leaving date the
 * cell is simply outside the person's time here.
 *
 * A day the TILL wrote is graded from the minutes actually worked — full, half or
 * absent — because "present" on its own says nothing about a person who touched
 * the machine for twenty minutes. A day the OFFICE wrote is never re-graded: a
 * manual mark is HR's decision and outranks the clock, which is the override the
 * owner asked to keep. Graded at READ time, not frozen at close, so a cashier
 * halfway through a shift is not stamped with a half day all afternoon.
 */
export function readDay(person: RegisterPerson, iso: string, holidayDates: ReadonlySet<string>): DayReading {
    if (person.joinedOn && iso < person.joinedOn) return { kind: "outside" };
    if (person.leftOn && iso > person.leftOn) return { kind: "outside" };
    const mark = person.marks[iso];
    if (mark) {
        // Lateness is judged on the arrival alone, so it stands whether or not the
        // day was graded — a short day and a late start are two different failings
        // and the register has to be able to say which one happened.
        const duty = dutyOn(person, iso);
        const lateBy = lateMinutes(mark.firstInAt, duty.start) ?? undefined;
        if (mark.source === "COUNTER" && mark.workedMinutes > 0) {
            return {
                kind: "marked",
                status: gradeDay(mark.workedMinutes, duty.minutes),
                stored: true,
                source: mark.source,
                workedMinutes: mark.workedMinutes,
                graded: true,
                lateBy,
            };
        }
        return { kind: "marked", status: mark.status, stored: true, source: mark.source, workedMinutes: mark.workedMinutes, lateBy };
    }
    if (holidayDates.has(iso)) return { kind: "marked", status: "HOLIDAY", stored: false };
    if (person.leaveDays[iso]) return { kind: "marked", status: "LEAVE", stored: false };
    if (person.weeklyOff.includes(weekdayOf(iso))) return { kind: "marked", status: "WEEKLY_OFF", stored: false };
    return { kind: "unmarked" };
}

/** Month totals for the summary column. */
export function summarise(person: RegisterPerson, days: readonly string[], holidayDates: ReadonlySet<string>) {
    const t = { present: 0, half: 0, absent: 0, leave: 0, off: 0, unmarked: 0 };
    for (const iso of days) {
        const r = readDay(person, iso, holidayDates);
        if (r.kind === "outside") continue;
        if (r.kind === "unmarked") { t.unmarked++; continue; }
        switch (r.status) {
            case "PRESENT":    t.present++; break;
            case "HALF_DAY":   t.half++; break;
            case "ABSENT":     t.absent++; break;
            case "LEAVE":      t.leave++; break;
            default:           t.off++;
        }
    }
    return t;
}
