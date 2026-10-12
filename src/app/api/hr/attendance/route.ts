import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { attendanceMarkSchema } from "@/shared/lib/schemas/hrAttendanceSchema";
import { businessTodayIso, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { monthBounds } from "@/modules/hr/lib/attendanceCalendar";
import { dutyHoursFor, dutyMinutesFor } from "@/shared/lib/hr/dutyTime";
import { loadSeasonalHours } from "@/shared/lib/hr/officeCalendarServer";
import type { RegisterPayload, RegisterPerson, HolidayDto } from "@/modules/hr/lib/attendanceTypes";
import { USER_BRANCHES_SELECT, branchIdsFrom } from "@/modules/hr/lib/staffBranchesServer";
import type { AttendanceStatus, LeaveKind } from "@/shared/lib/schemas/hrAttendanceSchema";

// /api/hr/attendance — the register.
//
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD   (default: the current month)
//       Every staff member with the marks stored inside the range, the approved
//       leave days, and the holidays. Days with no mark are read off the
//       calendar by the caller (attendanceCalendar.ts) — the API does not
//       invent rows. People who had left before `from` are not listed.
//   PUT { userId, date, status | null, note? }   — mark one day from the office.
//       null removes the mark: the day reads off the calendar again, or — when
//       the till measured it — goes back to the till's own record.

const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const today = businessTodayIso();
        const cur = monthBounds(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
        const from = searchParams.get("from") ?? cur.from;
        const to = searchParams.get("to") ?? cur.to;
        if (!ISO.test(from) || !ISO.test(to) || to < from) {
            return NextResponse.json({ error: "Bad date range" }, { status: 400 });
        }

        const [seasonal, users, marks, leaves, holidays] = await Promise.all([
            loadSeasonalHours(),
            prisma.user.findMany({
                orderBy: { name: "asc" },
                select: {
                    id: true, name: true, avatarUrl: true, role: true,
                    staffProfile: { select: { joinedOn: true, leftOn: true, weeklyOff: true, dutyMinutes: true, dutyStart: true, dutyEnd: true } },
                    ...USER_BRANCHES_SELECT,
                },
            }),
            prisma.attendanceDay.findMany({
                where: { date: { gte: dayOf(from), lte: dayOf(to) } },
                select: { userId: true, date: true, status: true, source: true, firstInAt: true, lastOutAt: true, workedMinutes: true, note: true },
            }),
            prisma.leaveRequest.findMany({
                where: { status: "APPROVED", fromDate: { lte: dayOf(to) }, toDate: { gte: dayOf(from) } },
                select: { userId: true, fromDate: true, toDate: true, kind: true },
            }),
            prisma.holiday.findMany({
                where: { date: { gte: dayOf(from), lte: dayOf(to) } },
                orderBy: { date: "asc" },
                select: { id: true, date: true, name: true, branchId: true },
            }),
        ]);

        /** This person's hours as they stand today — the headline figures. */
        const todayHours = (u: { staffProfile?: { dutyStart: string | null; dutyEnd: string | null } | null }) =>
            dutyHoursFor(u.staffProfile?.dutyStart, u.staffProfile?.dutyEnd, { seasonal });

        const byUser = new Map<number, RegisterPerson>();
        for (const u of users) {
            const leftOn = u.staffProfile?.leftOn ? toDateOnlyUtc(u.staffProfile.leftOn) : null;
            if (leftOn && leftOn < from) continue;
            byUser.set(u.id, {
                id: u.id, name: u.name, avatarUrl: u.avatarUrl, role: u.role,
                joinedOn: u.staffProfile?.joinedOn ? toDateOnlyUtc(u.staffProfile.joinedOn) : null,
                leftOn,
                weeklyOff: u.staffProfile?.weeklyOff ?? [0],
                branchIds: branchIdsFrom(u),
                // Today's resolved figures, for anything that wants one number.
                dutyMinutes: dutyMinutesFor(u.staffProfile?.dutyMinutes, todayHours(u).start, todayHours(u).end),
                dutyStart: todayHours(u).start,
                dutyEnd:   todayHours(u).end,
                // …and the raw settings, so the grid can re-resolve per day: the
                // shop's opening is not the same in December as in June.
                ownDutyMinutes: u.staffProfile?.dutyMinutes ?? null,
                ownDutyStart:   u.staffProfile?.dutyStart ?? null,
                ownDutyEnd:     u.staffProfile?.dutyEnd ?? null,
                seasonal,
                marks: {}, leaveDays: {},
            });
        }
        for (const m of marks) {
            const p = byUser.get(m.userId);
            if (!p) continue;
            p.marks[toDateOnlyUtc(m.date)] = {
                status: m.status as AttendanceStatus,
                source: m.source === "COUNTER" ? "COUNTER" : "OFFICE",
                firstInAt: m.firstInAt?.toISOString() ?? null,
                lastOutAt: m.lastOutAt?.toISOString() ?? null,
                workedMinutes: m.workedMinutes,
                note: m.note,
            };
        }
        for (const l of leaves) {
            const p = byUser.get(l.userId);
            if (!p) continue;
            const d = new Date(Math.max(l.fromDate.getTime(), dayOf(from).getTime()));
            const end = Math.min(l.toDate.getTime(), dayOf(to).getTime());
            while (d.getTime() <= end) {
                p.leaveDays[d.toISOString().slice(0, 10)] = l.kind as LeaveKind;
                d.setUTCDate(d.getUTCDate() + 1);
            }
        }

        const payload: RegisterPayload = {
            from, to,
            people: [...byUser.values()],
            holidays: holidays.map((h): HolidayDto => ({ id: h.id, date: toDateOnlyUtc(h.date), name: h.name, branchId: h.branchId })),
        };
        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e, "Failed to read the attendance register");
    }
}

export async function PUT(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.HR_ATTENDANCE_EDIT);
    if (response) return response;
    const { data, error } = await validateRequest(req, attendanceMarkSchema);
    if (error) return error;
    try {
        const date = dayOf(data.date);
        if (data.status === null) {
            // A day the till measured keeps its measurement: clearing the office
            // mark hands the day back to the clock (and to Employee Activity's
            // review) instead of deleting the minutes underneath it. A day only
            // the office ever wrote has nothing under it, and goes.
            const back = await prisma.attendanceDay.updateMany({
                where: { userId: data.userId, date, OR: [{ workedMinutes: { gt: 0 } }, { firstInAt: { not: null } }] },
                data:  { status: "PRESENT", source: "COUNTER", note: null, markedById: null },
            });
            if (!back.count) await prisma.attendanceDay.deleteMany({ where: { userId: data.userId, date } });
            return NextResponse.json({ ok: true, cleared: true });
        }
        const row = await prisma.attendanceDay.upsert({
            where: { userId_date: { userId: data.userId, date } },
            create: { userId: data.userId, date, status: data.status, source: "OFFICE", note: data.note ?? null, markedById: user.id },
            update: { status: data.status, source: "OFFICE", note: data.note ?? null, markedById: user.id },
            select: { status: true, source: true, firstInAt: true, lastOutAt: true, note: true },
        });
        return NextResponse.json({ ok: true, mark: { ...row, firstInAt: row.firstInAt?.toISOString() ?? null, lastOutAt: row.lastOutAt?.toISOString() ?? null } });
    } catch (e) {
        return handleApiError(e, "Failed to mark the day");
    }
}
