import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { thisCounterId } from "@/shared/lib/auth/counterPin";
import {
    dutyHoursFor, dutyMinutesFor, gradeDay, lateMinutes, overtimeMinutes, shortMinutes,
} from "@/shared/lib/hr/dutyTime";
import { monthOvertimeFor } from "@/modules/hr/lib/monthlyOvertime";
import { loadOfficeCalendar } from "@/shared/lib/hr/officeCalendarServer";
import { userBranchIds } from "@/modules/hr/lib/staffBranchesServer";
import { nextOfficeDay, shopDateFromIso } from "@/shared/lib/hr/seasonalHours";
import type { MyDay } from "@/shared/lib/hr/myDay";

/**
 * GET /api/hr/my-day — "how was my day?", answered to the person who worked it.
 *
 * Owner, 2026-09-22: the counter hand should be able to assess his own work. Until
 * now every one of these numbers existed only in the office register, so the man
 * being measured was the one person who could not see the measurement. This is the
 * whole of the counter's side of it, read at sign-out and shown on the login screen.
 *
 * No permission tick, and none is missing: it answers for the SIGNED-IN USER ONLY,
 * never takes a userId, and being signed in is the credential — the same reasoning
 * as `/api/hr/activity`. There is deliberately no way to ask it about somebody else;
 * that is the office register's job, behind its own permission.
 *
 * Counter only, like the measuring itself — off a till nothing is recorded (see
 * TRACK_OFF_COUNTER), so `tracked: false` comes back and the screen shows nothing
 * rather than an honest-looking zero.
 */

export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        if (thisCounterId() === null) {
            return NextResponse.json({ tracked: false });
        }
        const userId = Number(user!.id);
        const date = businessTodayIso();

        const [profile, day, month, calendar] = await Promise.all([
            prisma.staffProfile.findUnique({
                where: { userId },
                select: { dutyMinutes: true, dutyStart: true, dutyEnd: true, weeklyOff: true },
            }),
            prisma.attendanceDay.findUnique({
                where: { userId_date: { userId, date: new Date(`${date}T00:00:00.000Z`) } },
                select: { firstInAt: true, workedMinutes: true, counterId: true, source: true, status: true },
            }),
            monthOvertimeFor(userId, date),
            // His own calendar: the shop's holidays plus his branch's.
            userBranchIds(userId).then((ids) => loadOfficeCalendar(new Date(), 14, ids)),
        ]);

        // Today's own hours, on the season's curve. The person's typed hours still
        // win; only the fallback moves with the year.
        const today = shopDateFromIso(date);
        const seasonOpts = { on: today, seasonal: calendar.seasonal };
        const hours = dutyHoursFor(profile?.dutyStart, profile?.dutyEnd, seasonOpts);
        const dutyMinutes = dutyMinutesFor(profile?.dutyMinutes, hours.start, hours.end);

        /**
         * His own next working day — not the shop's.
         *
         * The shop's closed days and the holidays apply to everybody; his weekly off
         * is his alone, which is why this is computed here, behind the auth, and not
         * in the unauthenticated /api/office-hours/next that the login screen uses
         * when nobody has just signed out. A man whose day off is Friday must not be
         * told to come in on Friday because the shop is open.
         */
        const mine = nextOfficeDay(today, {
            ...calendar,
            weeklyOff: [...new Set([...(calendar.weeklyOff ?? []), ...(profile?.weeklyOff ?? [])])],
        });
        // His typed start overrides the curve on that day too, exactly as it does today.
        const nextDuty = {
            ...mine,
            startHhMm: dutyHoursFor(profile?.dutyStart, profile?.dutyEnd, { on: shopDateFromIso(mine.iso), seasonal: calendar.seasonal }).start,
        };
        const worked = day?.workedMinutes ?? 0;
        const officeMarked = day?.source === "OFFICE";

        // The counter he actually worked, read off the day's own row rather than
        // from this machine: a man who started on counter 1 and signed out on
        // counter 2 should see where his day was recorded, not where he is standing.
        const counter = day?.counterId
            ? await prisma.posCounter.findUnique({ where: { id: day.counterId }, select: { name: true } }).catch(() => null)
            : null;

        const payload: MyDay = {
            tracked: true,
            date,
            counterName: counter?.name ?? null,
            firstInAt: day?.firstInAt?.toISOString() ?? null,
            workedMinutes: worked,
            dutyMinutes,
            dutyStart: hours.start,
            dutyEnd: hours.end,
            lateMinutes: lateMinutes(day?.firstInAt ?? null, hours.start),
            shortMinutes: shortMinutes(worked, dutyMinutes),
            overtimeMinutes: overtimeMinutes(worked, dutyMinutes),
            // An office mark is the answer when there is one; otherwise the hours speak.
            grade: officeMarked && day?.status
                ? (day.status === "HALF_DAY" ? "HALF_DAY" : day.status === "ABSENT" ? "ABSENT" : "PRESENT")
                : gradeDay(worked, dutyMinutes),
            officeMarked,
            month,
            nextDuty,
        };
        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e);
    }
}
