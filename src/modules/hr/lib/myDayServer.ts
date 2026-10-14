import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import {
    dutyHoursFor, dutyMinutesFor, gradeDay, idleLimitMinutesFor, lateMinutes, overtimeMinutes, shortMinutes,
} from "@/shared/lib/hr/dutyTime";
import { monthOvertimeFor } from "@/modules/hr/lib/monthlyOvertime";
import { loadPayRules } from "@/modules/hr/lib/payRulesServer";
import { loadOfficeCalendar } from "@/shared/lib/hr/officeCalendarServer";
import { userBranchIds } from "@/modules/hr/lib/staffBranchesServer";
import { addShopDays, nextOfficeDay, shopDateFromIso } from "@/shared/lib/hr/seasonalHours";
import { parseHhMm, shopMinuteOf } from "@/shared/lib/hr/hhmm";
import { buildTimeline, resolveOpenSpan, type SpanDto } from "@/modules/hr/lib/attendanceBreakup";
import type { MyDay } from "@/shared/lib/hr/myDay";

/**
 * One person's day, as the counter's duty card shows it. Shared by
 * /api/hr/my-day (the signed-in person, read at sign-out) and /api/counter/day
 * (the lock screen, for whoever last worked this counter).
 */
export async function buildMyDay(userId: number): Promise<MyDay> {
    const date = businessTodayIso();

    const dateOnly = new Date(`${date}T00:00:00.000Z`);
    const [rules, profile, day, month, calendar, spanRows] = await Promise.all([
        loadPayRules(),
        prisma.staffProfile.findUnique({
            where: { userId },
            select: { dutyMinutes: true, dutyStart: true, dutyEnd: true, weeklyOff: true, idleLimitMinutes: true },
        }),
        prisma.attendanceDay.findUnique({
            where: { userId_date: { userId, date: dateOnly } },
            select: { firstInAt: true, lastSeenAt: true, workedMinutes: true, counterId: true, source: true, status: true },
        }),
        monthOvertimeFor(userId, date),
        // His own calendar: the shop's holidays plus his branch's.
        userBranchIds(userId).then((ids) => loadOfficeCalendar(new Date(), 14, ids)),
        // One person, one day: a handful of rows.
        prisma.attendanceSpan.findMany({
            where:   { userId, date: dateOnly },
            orderBy: { startedAt: "asc" },
            select:  { startedAt: true, endedAt: true, minutes: true, counterId: true, endedBy: true },
        }),
    ]);

    // Today's own hours, on the season's curve. The person's typed hours still
    // win; only the fallback moves with the year.
    const today = shopDateFromIso(date);
    const seasonOpts = { on: today, seasonal: calendar.seasonal };
    const hours = dutyHoursFor(profile?.dutyStart, profile?.dutyEnd, seasonOpts);
    const dutyMinutes = dutyMinutesFor(profile?.dutyMinutes, hours.start, hours.end);

    /**
     * His own next working day — not the shop's. The shop's closed days and the
     * holidays apply to everybody; his weekly off is his alone. A man whose day
     * off is Friday must not be told to come in on Friday because the shop is open.
     */
    const myCalendar = {
        ...calendar,
        weeklyOff: [...new Set([...(calendar.weeklyOff ?? []), ...(profile?.weeklyOff ?? [])])],
    };
    // Before his own start on a working day, the next duty is TODAY (owner,
    // 2026-10-14: the morning lock screen said "Tomorrow" at 9:18 for a 9:51
    // start). Asking from yesterday answers "is today a working day for him".
    const todayStart = parseHhMm(hours.start);
    const fromYesterday = nextOfficeDay(addShopDays(today, -1), myCalendar);
    const mine = fromYesterday.iso === date && todayStart !== null && shopMinuteOf(Date.now()) < todayStart
        ? fromYesterday
        : nextOfficeDay(today, myCalendar);
    // His typed start overrides the curve on that day too, exactly as it does today.
    const nextDuty = {
        ...mine,
        startHhMm: dutyHoursFor(profile?.dutyStart, profile?.dutyEnd, { on: shopDateFromIso(mine.iso), seasonal: calendar.seasonal }).start,
    };
    const worked = day?.workedMinutes ?? 0;

    // The same on / off lines the office's day card draws, open stretches closed
    // the same way, so the till and the register never tell two stories.
    const idleLimit = idleLimitMinutesFor(profile?.idleLimitMinutes);
    const lastSeen = day?.lastSeenAt?.toISOString() ?? null;
    const lived = buildTimeline(
        spanRows
            .map((s): SpanDto => ({
                startedAt: s.startedAt.toISOString(),
                endedAt:   s.endedAt?.toISOString() ?? null,
                minutes:   s.minutes,
                counterId: s.counterId,
                endedBy:   s.endedBy as SpanDto["endedBy"],
            }))
            .map((s) => resolveOpenSpan(s, lastSeen, true, idleLimit))
            .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
        idleLimit,
        new Date().toISOString(),
    ).map(({ kind, from, to, open }) => ({ kind, from, to, ...(open ? { open } : {}) }));
    const officeMarked = day?.source === "OFFICE";

    // The counter he actually worked, read off the day's own row rather than
    // from this machine: a man who started on counter 1 and signed out on
    // counter 2 should see where his day was recorded, not where he is standing.
    const counter = day?.counterId
        ? await prisma.posCounter.findUnique({ where: { id: day.counterId }, select: { name: true } }).catch(() => null)
        : null;

    return {
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
            : gradeDay(worked, dutyMinutes, rules),
        officeMarked,
        month,
        nextDuty,
        lived,
    };
}
