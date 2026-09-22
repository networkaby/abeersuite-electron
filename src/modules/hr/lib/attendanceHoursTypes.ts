// The wire shape of the hours breakup, kept away from the server loader so the
// dialog can import it without dragging Prisma into the browser bundle.

import type { DayBreakup } from "./attendanceBreakup";
import type { AttendanceEffect, PayRules } from "@/shared/lib/hr/payRules";

export interface HoursPayload {
    userId: number;
    userName: string;
    from: string;
    to: string;
    days: DayBreakup[];
    /**
     * The rules in force, so a card can say WHY a penalty is what it is —
     * "2× the minutes late", "first 2 late days free" — instead of showing a
     * figure with no reason attached.
     */
    rules: PayRules;
    /**
     * This person's idle limit, in minutes — the gap after which the clock stops
     * counting. It is WHY a card's "away" minutes were not credited, and a figure
     * with no reason attached is the one people dispute.
     */
    idleLimitMinutes: number;
    /**
     * What the clock did to this person's pay over the whole range, netted:
     * overtime only counts once it has paid back the hours they fell short on
     * other days. Per-day over/short is on each day; this is the figure payroll
     * actually pays, and it belongs to the range, not to any one day.
     */
    effect: AttendanceEffect;
}
