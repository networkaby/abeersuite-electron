import "server-only";

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { dutyHoursFor, dutyMinutesFor, gradeDay } from "@/shared/lib/hr/dutyTime";
import { loadPayRules } from "@/modules/hr/lib/payRulesServer";
import { loadSeasonalHours } from "@/shared/lib/hr/officeCalendarServer";
import { shopDateFromIso } from "@/shared/lib/hr/seasonalHours";
import { ATTENDANCE_SOURCE_SELECT, autoCounts, workedOf } from "@/shared/lib/hr/attendanceSource";
import { unpaidLeaveDaysFor } from "./leaveBalance";
import { holidayDatesFor, weekdayOf } from "./attendanceCalendar";
import { userBranchIds } from "./staffBranchesServer";

/**
 * The attendance seam for payroll (agreed with the payroll session, 2026-09-20).
 *
 * `payrollProrate.ts` walks a period day by day and assumes every employed day is
 * payable. This answers the exceptions for one person inside a range, as
 * ISO date → factor: 0 for a day not paid at all, 0.5 for a half day. A day
 * absent from the map is a normal paid day — weekly offs, holidays and paid
 * leave included, because the structure is monthly and those days are paid.
 *
 * Not payable: ABSENT, and a LEAVE day that `unpaidLeaveDaysFor` calls unpaid —
 * either its kind is not a paid one, or it is past that kind's yearly quota, which
 * is the owner's "going over does not block, it just is not paid". That one helper
 * is the only place the question is answered, so payroll and the screens cannot
 * disagree about which day was the thirteenth. Half: HALF_DAY. Everything else is
 * read from the stored register rows; days nobody marked are paid, which is what
 * "calendar days are fine for now" means until the register is in daily use.
 *
 * A day the TILL wrote is graded from the minutes actually worked, by the same
 * `gradeDay` the register draws — payroll and the screen must never disagree
 * about someone's salary. A day the OFFICE wrote keeps its typed status: HR
 * overrules the clock, here as everywhere. Note the consequence, which is the
 * point of the whole exercise: a counter day stored as PRESENT can still come
 * out HALF or ABSENT once the hours are counted.
 *
 * The minutes are the CORRECTED ones where a person fixed the activity card,
 * and a day switched to manual is paid on its mark. `attendanceSource.ts`.
 */
export async function nonPayableDays(
    userId: number, fromIso: string, toIso: string,
    /** Read-only "what would Auto pay": every day the till measured is graded on
     *  its minutes, manual mark or not. A manual W / H keeps its off day. */
    opts: { clockOnly?: boolean } = {},
): Promise<Map<string, 0 | 0.5>> {
    const from = new Date(`${fromIso}T00:00:00.000Z`);
    const to = new Date(`${toIso}T00:00:00.000Z`);
    const [seasonal, rules, profile, rows, unpaid, holidayRows, branchIds] = await Promise.all([
        loadSeasonalHours(),
        loadPayRules(),
        prisma.staffProfile.findUnique({ where: { userId }, select: { dutyMinutes: true, dutyStart: true, dutyEnd: true, weeklyOff: true } }),
        // Every stored row, not only the three exception statuses: a COUNTER day
        // stored as PRESENT may still grade to HALF or ABSENT on its hours, and
        // filtering by status first would hide exactly those days from payroll.
        prisma.attendanceDay.findMany({
            where: { userId, date: { gte: from, lte: to } },
            select: { date: true, status: true, ...ATTENDANCE_SOURCE_SELECT },
        }),
        unpaidLeaveDaysFor(userId, fromIso, toIso),
        prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true, branchId: true } }),
        userBranchIds(userId),
    ]);
    // The days this person's shop was shut. A shut day is a paid day: minutes on
    // it are extra duty (payRulesApply.ts), never a grade — a short spell at the
    // till on a holiday must not turn it into an unpaid ABSENT (fixed 2026-11-06;
    // weekly offs were already safe, prorate skips them, but are named too).
    const holidays = holidayDatesFor(
        holidayRows.map((h, i) => ({ id: i, name: "", date: h.date.toISOString().slice(0, 10), branchId: h.branchId })),
        branchIds,
    );
    const offDays = new Set(profile?.weeklyOff ?? []);
    /**
     * What was owed on THAT day.
     *
     * Resolved per row rather than once for the range, because the shop's opening
     * moves through the year while its closing does not: a fixed figure would grade
     * a whole winter month against summer hours and dock pay for days that were
     * worked in full. A person with hours of their own gets the same number every
     * day, which is what setting them means.
     */
    const dutyOnDay = (iso: string) => {
        const hours = dutyHoursFor(profile?.dutyStart, profile?.dutyEnd, {
            on: shopDateFromIso(iso), seasonal,
        });
        return dutyMinutesFor(profile?.dutyMinutes, hours.start, hours.end);
    };
    const out = new Map<string, 0 | 0.5>();
    for (const r of rows) {
        const iso = r.date.toISOString().slice(0, 10);
        const offMark = r.status === "WEEKLY_OFF" || r.status === "HOLIDAY";
        const shut = holidays.has(iso) || offDays.has(weekdayOf(iso));
        const graded = !shut && (opts.clockOnly ? workedOf(r) > 0 && !offMark : autoCounts(r));
        const status = graded ? gradeDay(workedOf(r), dutyOnDay(iso), rules) : r.status;
        if (status === "ABSENT") out.set(iso, 0);
        else if (status === "HALF_DAY") out.set(iso, 0.5);
        else if (status === "LEAVE" && unpaid.has(iso)) out.set(iso, 0);
    }
    return out;
}
