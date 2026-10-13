import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { attendanceDaySourceSchema, type AttendanceStatus, type LeaveKind } from "@/shared/lib/schemas/hrAttendanceSchema";
import { businessTodayIso, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { dutyHoursFor, dutyMinutesFor, gradeDay, lateMinutes, overtimeMinutes, shortMinutes } from "@/shared/lib/hr/dutyTime";
import { loadSeasonalHours } from "@/shared/lib/hr/officeCalendarServer";
import { shopDateFromIso } from "@/shared/lib/hr/seasonalHours";
import { ATTENDANCE_SOURCE_SELECT, lateOf, workedOf } from "@/shared/lib/hr/attendanceSource";
import { loadPayRules } from "@/modules/hr/lib/payRulesServer";
import { holidayDatesFor, weekdayOf } from "@/modules/hr/lib/attendanceCalendar";
import { USER_BRANCHES_SELECT, branchIdsFrom } from "@/modules/hr/lib/staffBranchesServer";
import type { DayReviewPayload, DayReviewRow } from "@/modules/hr/lib/attendanceTypes";

// /api/hr/attendance/review — Employee Activity's day review.
//
// Owner, 2026-10-13: a day carries both the till's figures (auto) and the
// office's mark (manual), and a toggle picks which one pays — the Attendance
// page's mark flips it to manual. Auto's figures can be corrected one by one on
// the activity card. `shared/lib/hr/attendanceSource.ts` is the rule every pay
// reader follows; this route only shows the day and records the change.
//
//   GET  ?date=YYYY-MM-DD   (default: yesterday)
//        Everybody on the staff that day: both sides, which one pays, and
//        auto's figures graded against THAT day's duty.
//   POST { date, userId, useManual?, overrideWorkedMinutes?, overrideLateMinutes? }
//        Flips the side, or corrects / restores a till figure.

const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const today = businessTodayIso();
        const date = new URL(req.url).searchParams.get("date")
            ?? new Date(dayOf(today).getTime() - 86_400_000).toISOString().slice(0, 10);
        if (!ISO.test(date)) return NextResponse.json({ error: "Bad date" }, { status: 400 });
        const on = dayOf(date);

        const [seasonal, rules, users, marks, leaves, holidays] = await Promise.all([
            loadSeasonalHours(),
            loadPayRules(),
            prisma.user.findMany({
                orderBy: { name: "asc" },
                select: {
                    id: true, name: true, avatarUrl: true, role: true,
                    staffProfile: { select: { joinedOn: true, leftOn: true, weeklyOff: true, dutyMinutes: true, dutyStart: true, dutyEnd: true } },
                    ...USER_BRANCHES_SELECT,
                },
            }),
            prisma.attendanceDay.findMany({
                where:  { date: on },
                select: {
                    userId: true, status: true, manualStatus: true, firstInAt: true, lastOutAt: true, lastSeenAt: true,
                    note: true, correctedById: true, ...ATTENDANCE_SOURCE_SELECT,
                },
            }),
            prisma.leaveRequest.findMany({
                where:  { status: "APPROVED", fromDate: { lte: on }, toDate: { gte: on } },
                select: { userId: true, kind: true },
            }),
            prisma.holiday.findMany({
                where:  { date: on },
                select: { id: true, date: true, name: true, branchId: true },
            }),
        ]);

        const correctorIds = [...new Set(marks.map((m) => m.correctedById).filter((v): v is number => v != null))];
        const correctors = correctorIds.length
            ? new Map((await prisma.user.findMany({ where: { id: { in: correctorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
            : new Map<number, string>();
        const markOf = new Map(marks.map((m) => [m.userId, m]));
        const leaveOf = new Map(leaves.map((l) => [l.userId, l.kind as LeaveKind]));
        const holidayDtos = holidays.map((h) => ({ id: h.id, date: toDateOnlyUtc(h.date), name: h.name, branchId: h.branchId }));

        const rows: DayReviewRow[] = [];
        for (const u of users) {
            const p = u.staffProfile;
            const joinedOn = p?.joinedOn ? toDateOnlyUtc(p.joinedOn) : null;
            const leftOn = p?.leftOn ? toDateOnlyUtc(p.leftOn) : null;
            // Not on the staff that day — the same window the register uses.
            if (joinedOn && joinedOn > date) continue;
            if (leftOn && leftOn < date) continue;

            const m = markOf.get(u.id) ?? null;
            const hours = dutyHoursFor(p?.dutyStart, p?.dutyEnd, { on: shopDateFromIso(date), seasonal });
            const duty = dutyMinutesFor(p?.dutyMinutes, hours.start, hours.end);
            const worked = m ? workedOf(m) : 0;
            const tillLate = lateMinutes(m?.firstInAt ?? null, hours.start, undefined, rules.lateGraceMinutes) ?? 0;
            const corrected = { worked: m?.overrideWorkedMinutes != null, late: m?.overrideLateMinutes != null };
            const holiday = holidayDtos.find((h) => holidayDatesFor([h], branchIdsFrom(u)).size > 0) ?? null;

            rows.push({
                userId: u.id, name: u.name, avatarUrl: u.avatarUrl, role: u.role,
                uses: !m ? null : m.source === "OFFICE" ? "MANUAL" : "AUTO",
                canAuto: !!m && (m.workedMinutes > 0 || !!m.firstInAt || corrected.worked),
                // An office mark from before `manualStatus` existed is its status.
                manualStatus: (m?.manualStatus ?? (m?.source === "OFFICE" ? m.status : null)) as AttendanceStatus | null,
                firstInAt: m?.firstInAt?.toISOString() ?? null,
                lastOutAt: (m?.lastOutAt ?? m?.lastSeenAt)?.toISOString() ?? null,
                workedMinutes: worked,
                lateBy: m ? lateOf(m, tillLate) : tillLate,
                till: { workedMinutes: m?.workedMinutes ?? 0, lateBy: tillLate },
                corrected,
                correctedBy: corrected.worked || corrected.late ? (correctors.get(m!.correctedById ?? 0) ?? null) : null,
                dutyMinutes: duty,
                dutyStart: hours.start,
                dutyEnd: hours.end,
                grade: gradeDay(worked, duty, rules),
                overtimeMinutes: overtimeMinutes(worked, duty),
                shortMinutes: shortMinutes(worked, duty),
                weeklyOff: (p?.weeklyOff ?? [0]).includes(weekdayOf(date)),
                holidayName: holiday?.name ?? null,
                leaveKind: leaveOf.get(u.id) ?? null,
                note: m?.note ?? null,
            });
        }

        const payload: DayReviewPayload = { date, today, rows };
        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e, "Failed to read the day");
    }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.HR_ATTENDANCE_EDIT);
    if (response) return response;
    const { data, error } = await validateRequest(req, attendanceDaySourceSchema);
    if (error) return error;

    const correcting = data.overrideWorkedMinutes !== undefined || data.overrideLateMinutes !== undefined;
    // Today is still being worked — a corrected figure typed at noon would
    // freeze the afternoon out of it.
    if (correcting && data.date >= businessTodayIso()) {
        return NextResponse.json({ error: "Only a finished day can be corrected — today is still running." }, { status: 422 });
    }

    try {
        const row = await prisma.attendanceDay.findUnique({
            where:  { userId_date: { userId: data.userId, date: dayOf(data.date) } },
            select: { id: true, status: true, manualStatus: true, source: true, workedMinutes: true, firstInAt: true, overrideWorkedMinutes: true },
        });
        if (!row) return NextResponse.json({ error: "Nothing recorded on this day — mark it on the Attendance page." }, { status: 404 });

        // An office mark from before `manualStatus` existed is its status.
        const mark = row.manualStatus ?? (row.source === "OFFICE" ? row.status : null);
        const patch: Prisma.AttendanceDayUpdateInput = {};
        if (correcting) {
            if (data.overrideWorkedMinutes !== undefined) patch.overrideWorkedMinutes = data.overrideWorkedMinutes;
            if (data.overrideLateMinutes !== undefined) patch.overrideLateMinutes = data.overrideLateMinutes;
            patch.correctedById = user!.id;
            patch.correctedAt = new Date();
        }
        if (data.useManual === true) {
            if (!mark) return NextResponse.json({ error: "No manual mark on this day yet — pick one first." }, { status: 422 });
            Object.assign(patch, { source: "OFFICE", status: mark, manualStatus: mark });
        } else if (data.useManual === false) {
            const worked = data.overrideWorkedMinutes !== undefined ? data.overrideWorkedMinutes : row.overrideWorkedMinutes;
            if (!(row.workedMinutes > 0 || row.firstInAt || worked != null)) {
                return NextResponse.json({ error: "The till recorded nothing on this day — there is no auto to use." }, { status: 422 });
            }
            // The mark stays in `manualStatus`, so switching back costs nothing.
            Object.assign(patch, { source: "COUNTER", status: "PRESENT", manualStatus: mark });
        }
        await prisma.attendanceDay.update({ where: { id: row.id }, data: patch });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to save the day");
    }
}
