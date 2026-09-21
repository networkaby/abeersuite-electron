import "server-only";

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { dutyMinutesFor, gradeDay } from "@/shared/lib/hr/dutyTime";

/**
 * The attendance seam for payroll (agreed with the payroll session, 2026-09-20).
 *
 * `payrollProrate.ts` walks a period day by day and assumes every employed day is
 * payable. This answers the exceptions for one person inside a range, as
 * ISO date → factor: 0 for a day not paid at all, 0.5 for a half day. A day
 * absent from the map is a normal paid day — weekly offs, holidays and paid
 * leave included, because the structure is monthly and those days are paid.
 *
 * Not payable: ABSENT, and LEAVE whose approved request is UNPAID. Half:
 * HALF_DAY. Everything is read from the stored register rows; days nobody
 * marked are paid, which is what "calendar days are fine for now" means until
 * the register is in daily use.
 *
 * A day the TILL wrote is graded from the minutes actually worked, by the same
 * `gradeDay` the register draws — payroll and the screen must never disagree
 * about someone's salary. A day the OFFICE wrote keeps its typed status: HR
 * overrules the clock, here as everywhere. Note the consequence, which is the
 * point of the whole exercise: a counter day stored as PRESENT can still come
 * out HALF or ABSENT once the hours are counted.
 */
export async function nonPayableDays(userId: number, fromIso: string, toIso: string): Promise<Map<string, 0 | 0.5>> {
    const from = new Date(`${fromIso}T00:00:00.000Z`);
    const to = new Date(`${toIso}T00:00:00.000Z`);
    const [profile, rows, unpaidLeaves] = await Promise.all([
        prisma.staffProfile.findUnique({ where: { userId }, select: { dutyMinutes: true, dutyStart: true, dutyEnd: true } }),
        // Every stored row, not only the three exception statuses: a COUNTER day
        // stored as PRESENT may still grade to HALF or ABSENT on its hours, and
        // filtering by status first would hide exactly those days from payroll.
        prisma.attendanceDay.findMany({
            where: { userId, date: { gte: from, lte: to } },
            select: { date: true, status: true, source: true, workedMinutes: true },
        }),
        prisma.leaveRequest.findMany({
            where: { userId, status: "APPROVED", kind: "UNPAID", fromDate: { lte: to }, toDate: { gte: from } },
            select: { fromDate: true, toDate: true },
        }),
    ]);
    const duty = dutyMinutesFor(profile?.dutyMinutes, profile?.dutyStart, profile?.dutyEnd);
    const unpaid = new Set<string>();
    for (const l of unpaidLeaves) {
        const d = new Date(Math.max(l.fromDate.getTime(), from.getTime()));
        const end = Math.min(l.toDate.getTime(), to.getTime());
        while (d.getTime() <= end) { unpaid.add(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
    }
    const out = new Map<string, 0 | 0.5>();
    for (const r of rows) {
        const iso = r.date.toISOString().slice(0, 10);
        const status =
            r.source === "COUNTER" && r.workedMinutes > 0
                ? gradeDay(r.workedMinutes, duty)
                : r.status;
        if (status === "ABSENT") out.set(iso, 0);
        else if (status === "HALF_DAY") out.set(iso, 0.5);
        else if (status === "LEAVE" && unpaid.has(iso)) out.set(iso, 0);
    }
    return out;
}
