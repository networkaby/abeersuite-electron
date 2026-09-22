import "server-only";

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { dutyMinutesFor, gradeDay, overtimeMinutes, shortMinutes } from "@/shared/lib/hr/dutyTime";
import { monthBounds } from "@/modules/hr/lib/attendanceCalendar";
import type { MonthOvertime } from "@/shared/lib/hr/myDay";

/**
 * The month's overtime, netted — what the counter's own card shows him.
 *
 * Owner, 2026-09-22: *"monthly overtime is after adjusting the full month. 3 day
 * has less duty total 5h, user has to make up 5h by overtime. Additional overtime
 * of the month attracts extra payment."* So a day's extra hour is not money on its
 * own: it first pays back the hours he fell short on other days, and only what
 * survives that is real overtime.
 *
 *   surplus 8h, shortfall 5h  →  5h made up, 3h payable, nothing owed
 *   surplus 2h, shortfall 5h  →  2h made up, 0 payable, 3h still owed
 *
 * WHICH DAYS COUNT AS SHORT is the part that needed the owner's word, because a
 * day can be docked twice without care. A day graded ABSENT is already paid at
 * zero by payroll, and a half day at a half; charging its missing hours against
 * his overtime as well would punish the same absence a second time. So only the
 * shortfall that payroll has NOT already taken is counted:
 *
 *   PRESENT   → the whole shortfall (he was paid a full day and did not work it)
 *   HALF_DAY  → the shortfall beyond the half-day payroll already withheld
 *   ABSENT    → nothing at all
 *
 * A WEEKLY OFF is different from both sides. Owner, 2026-09-22: *"if work on
 * weekly off day it will give extra"* — but also *"extra day attendance not
 * always extra payment"*, because the hours go into the same pot first. So an
 * off day owes no duty: every minute worked on it is surplus, and it can never
 * be short, half or absent. Coming in on a Sunday for four hours while owing
 * five hours elsewhere in the month therefore pays nothing extra — it makes up
 * four of the five, which is exactly what the owner described.
 *
 * Only days the TILL measured are judged. A day the office marked by hand has no
 * honest minute count behind it, and HR's mark overrules the clock everywhere
 * else in this module — it does here too, by being left out of both sides.
 *
 * Nothing here pays anybody. It is a figure on a screen until payroll is wired to
 * it deliberately; `payableMinutes` is the number that wiring should read.
 */
/* The shape lives in shared/lib/hr/myDay.ts — the login screen reads it too. */

export type { MonthOvertime };

export async function monthOvertimeFor(userId: number, todayIso: string): Promise<MonthOvertime> {
    const { from, to } = monthBounds(Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)));
    const [profile, rows] = await Promise.all([
        prisma.staffProfile.findUnique({
            where: { userId },
            select: { dutyMinutes: true, dutyStart: true, dutyEnd: true, weeklyOff: true },
        }),
        prisma.attendanceDay.findMany({
            where: {
                userId,
                date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
                source: "COUNTER",
            },
            select: { date: true, workedMinutes: true },
        }),
    ]);
    const duty = dutyMinutesFor(profile?.dutyMinutes, profile?.dutyStart, profile?.dutyEnd);

    const offDays = new Set(profile?.weeklyOff ?? []);
    let surplusMinutes = 0;
    let shortfallMinutes = 0;
    let weeklyOffMinutes = 0;
    for (const r of rows) {
        const worked = r.workedMinutes;
        if (worked <= 0) continue;   // nothing measured — not his surplus and not his debt

        // His own day off. No duty was owed, so the whole of it is surplus and
        // none of it can be a shortfall.
        if (offDays.has(r.date.getUTCDay())) {
            surplusMinutes += worked;
            weeklyOffMinutes += worked;
            continue;
        }

        surplusMinutes += overtimeMinutes(worked, duty);

        const short = shortMinutes(worked, duty);
        if (short === 0) continue;
        const grade = gradeDay(worked, duty);
        if (grade === "ABSENT") continue;                       // payroll already took the whole day
        const alreadyWithheld = grade === "HALF_DAY" ? Math.round(duty / 2) : 0;
        shortfallMinutes += Math.max(0, short - alreadyWithheld);
    }

    const madeUpMinutes = Math.min(surplusMinutes, shortfallMinutes);
    return {
        month: todayIso.slice(0, 7),
        surplusMinutes,
        weeklyOffMinutes,
        shortfallMinutes,
        madeUpMinutes,
        payableMinutes: Math.max(0, surplusMinutes - shortfallMinutes),
        owedMinutes: Math.max(0, shortfallMinutes - surplusMinutes),
    };
}
