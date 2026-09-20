// What a day reads as when nobody marked it, and the small date arithmetic the
// register needs. Pure — shared by the API and the grid.

import type { AttendanceStatus } from "@/shared/lib/schemas/hrAttendanceSchema";
import type { RegisterPerson } from "./attendanceTypes";

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
    | { kind: "marked"; status: AttendanceStatus; stored: boolean; source?: "COUNTER" | "OFFICE" };

/**
 * A stored mark wins. Otherwise the calendar answers: holiday, then approved
 * leave, then weekly off. Before the joining date or after the leaving date the
 * cell is simply outside the person's time here.
 */
export function readDay(person: RegisterPerson, iso: string, holidayDates: ReadonlySet<string>): DayReading {
    if (person.joinedOn && iso < person.joinedOn) return { kind: "outside" };
    if (person.leftOn && iso > person.leftOn) return { kind: "outside" };
    const mark = person.marks[iso];
    if (mark) return { kind: "marked", status: mark.status, stored: true, source: mark.source };
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
