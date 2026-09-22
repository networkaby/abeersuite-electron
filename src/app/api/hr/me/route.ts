import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { businessTodayIso, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { monthBounds } from "@/modules/hr/lib/attendanceCalendar";
import { dutyHoursFor, dutyMinutesFor } from "@/shared/lib/hr/dutyTime";
import { loadSeasonalHours } from "@/shared/lib/hr/officeCalendarServer";
import { monthOvertimeFor } from "@/modules/hr/lib/monthlyOvertime";
import { nonPayableDays } from "@/modules/hr/lib/attendancePayable";
import { LEAVE_INCLUDE, toLeaveDto } from "@/modules/hr/lib/leaveServer";
import type { MyHrPayload } from "@/modules/hr/lib/myHrTypes";
import type { RegisterPerson, HolidayDto, AttendanceMark } from "@/modules/hr/lib/attendanceTypes";
import type { AttendanceStatus, LeaveKind } from "@/shared/lib/schemas/hrAttendanceSchema";

/**
 * GET /api/hr/me?month=YYYY-MM — one month of my own working life.
 *
 * Owner, 2026-09-22: a staff member gets ONE page showing his own data, on one
 * tick, without the rest of HR opening with it. This is that page's only read.
 *
 * No permission tick, and none is missing — the same reasoning as `/api/hr/my-day`
 * and `/api/hr/activity`: it answers for the SIGNED-IN USER ONLY and there is
 * deliberately no way to ask it about somebody else. Asking about a colleague is
 * the office register's job, behind the office register's grant.
 *
 * One read for the whole page (§7: fewer round trips beats a tidy route per card).
 * The shape is the register's own `RegisterPerson`, so the client can reuse
 * `readDay` / `summarise` and the two screens can never disagree about a day.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const today = businessTodayIso();
        const asked = new URL(req.url).searchParams.get("month");
        if (asked && !MONTH.test(asked)) {
            return NextResponse.json({ error: "Bad month" }, { status: 400 });
        }
        const month = asked ?? today.slice(0, 7);
        const { from, to } = monthBounds(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
        const userId = Number(user.id);
        // Everything below is asked about the month being LOOKED AT, not about
        // the month we happen to be in: browsing back to August must not answer
        // with September's overtime. A past month is read to its last day; the
        // running month stops at today, because the rest of it is not worked yet.
        const upto = to < today ? to : today;

        const [seasonal, me, marks, leaveDaysRows, holidays, myLeaves, overtime] = await Promise.all([
            loadSeasonalHours(),
            prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true, name: true, avatarUrl: true, role: true,
                    staffProfile: { select: { joinedOn: true, leftOn: true, weeklyOff: true, dutyMinutes: true, dutyStart: true, dutyEnd: true, staffCode: true } },
                },
            }),
            prisma.attendanceDay.findMany({
                where: { userId, date: { gte: dayOf(from), lte: dayOf(to) } },
                select: { date: true, status: true, source: true, firstInAt: true, lastOutAt: true, workedMinutes: true, note: true },
            }),
            prisma.leaveRequest.findMany({
                where: { userId, status: "APPROVED", fromDate: { lte: dayOf(to) }, toDate: { gte: dayOf(from) } },
                select: { fromDate: true, toDate: true, kind: true },
            }),
            prisma.holiday.findMany({
                where: { date: { gte: dayOf(from), lte: dayOf(to) } },
                orderBy: { date: "asc" },
                select: { id: true, date: true, name: true, branchId: true },
            }),
            prisma.leaveRequest.findMany({
                where: { userId },
                orderBy: [{ status: "asc" }, { fromDate: "desc" }],
                take: 100,
                include: LEAVE_INCLUDE,
            }),
            monthOvertimeFor(userId, upto),
        ]);
        if (!me) return NextResponse.json({ error: "User not found" }, { status: 404 });

        const hours = dutyHoursFor(me.staffProfile?.dutyStart, me.staffProfile?.dutyEnd, { seasonal });
        const person: RegisterPerson = {
            id: me.id, name: me.name, avatarUrl: me.avatarUrl, role: me.role,
            joinedOn: me.staffProfile?.joinedOn ? toDateOnlyUtc(me.staffProfile.joinedOn) : null,
            leftOn: me.staffProfile?.leftOn ? toDateOnlyUtc(me.staffProfile.leftOn) : null,
            weeklyOff: me.staffProfile?.weeklyOff ?? [0],
            dutyMinutes: dutyMinutesFor(me.staffProfile?.dutyMinutes, hours.start, hours.end),
            dutyStart: hours.start,
            dutyEnd: hours.end,
            ownDutyMinutes: me.staffProfile?.dutyMinutes ?? null,
            ownDutyStart: me.staffProfile?.dutyStart ?? null,
            ownDutyEnd: me.staffProfile?.dutyEnd ?? null,
            seasonal,
            marks: {}, leaveDays: {},
        };
        for (const m of marks) {
            person.marks[toDateOnlyUtc(m.date)] = {
                status: m.status as AttendanceStatus,
                source: m.source === "COUNTER" ? "COUNTER" : "OFFICE",
                firstInAt: m.firstInAt?.toISOString() ?? null,
                lastOutAt: m.lastOutAt?.toISOString() ?? null,
                workedMinutes: m.workedMinutes,
                note: m.note,
            } satisfies AttendanceMark;
        }
        for (const l of leaveDaysRows) {
            const d = new Date(Math.max(l.fromDate.getTime(), dayOf(from).getTime()));
            const end = Math.min(l.toDate.getTime(), dayOf(to).getTime());
            while (d.getTime() <= end) {
                person.leaveDays[d.toISOString().slice(0, 10)] = l.kind as LeaveKind;
                d.setUTCDate(d.getUTCDate() + 1);
            }
        }

        // Earnings, the same way payroll would see the month: a day is paid unless
        // it is absent (0) or half (0.5). `upto` keeps a month still running from
        // counting days nobody has worked yet.
        const cut = upto >= from ? await nonPayableDays(userId, from, upto) : new Map<string, 0 | 0.5>();
        let notPayable = 0;
        for (const v of cut.values()) notPayable += 1 - v;

        const payload: MyHrPayload = {
            month, from, to, today,
            person,
            holidays: holidays.map((h): HolidayDto => ({ id: h.id, date: toDateOnlyUtc(h.date), name: h.name, branchId: h.branchId })),
            leaves: myLeaves.map(toLeaveDto),
            overtime,
            staffCode: me.staffProfile?.staffCode ?? null,
            isCurrentMonth: month === today.slice(0, 7),
            lostDays: Math.round(notPayable * 2) / 2,
        };
        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e, "Failed to read your HR summary");
    }
}
