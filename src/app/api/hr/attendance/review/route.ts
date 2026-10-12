import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { attendanceReviewSchema, type AttendanceStatus, type LeaveKind } from "@/shared/lib/schemas/hrAttendanceSchema";
import { businessTodayIso, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { dutyHoursFor, dutyMinutesFor, gradeDay, lateMinutes, overtimeMinutes, shortMinutes } from "@/shared/lib/hr/dutyTime";
import { loadSeasonalHours } from "@/shared/lib/hr/officeCalendarServer";
import { shopDateFromIso } from "@/shared/lib/hr/seasonalHours";
import { reviewOf } from "@/shared/lib/hr/attendanceReview";
import { loadPayRules } from "@/modules/hr/lib/payRulesServer";
import { holidayDatesFor, weekdayOf } from "@/modules/hr/lib/attendanceCalendar";
import { USER_BRANCHES_SELECT, branchIdsFrom } from "@/modules/hr/lib/staffBranchesServer";
import type { DayReviewPayload, DayReviewRow } from "@/modules/hr/lib/attendanceTypes";

// /api/hr/attendance/review — Employee Activity's day review.
//
// Owner, 2026-10-12: auto attendance is on trial, so the till's figures reach
// no pay until somebody accepts them — and that is decided at the source, one
// day for the whole staff at a time. `shared/lib/hr/attendanceReview.ts` is the
// rule every pay reader follows; this route only shows the day and records the
// decision.
//
//   GET  ?date=YYYY-MM-DD   (default: yesterday)
//        Everybody on the staff that day, with the clock's figures graded
//        against THAT day's duty, and the decision standing on each.
//   POST { date, decisions: [{ userId, review: ACCEPTED | REJECTED | null }] }
//        Records the decisions, each against the minutes it was made on.

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

        const [seasonal, rules, users, marks, leaves, holidays, waiting] = await Promise.all([
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
                    userId: true, status: true, source: true, firstInAt: true, lastOutAt: true, lastSeenAt: true,
                    workedMinutes: true, note: true, review: true, reviewedMinutes: true, reviewedById: true, reviewedAt: true,
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
            // Every past day still waiting, for "next day waiting". The same test
            // as `reviewOf`, said as a filter so it is one cheap read rather than
            // every till row ever written: a measured till day with no decision,
            // or one whose minutes moved after it was decided.
            //
            // A model read on purpose, never `$queryRaw`: on a counter writing to
            // the office, a raw query rides the WRITE client to Supabase instead
            // of the replica (prismaClient.ts) — and broke this screen there.
            prisma.attendanceDay.findMany({
                where: {
                    source: "COUNTER",
                    workedMinutes: { gt: 0 },
                    date: { lt: dayOf(today) },
                    OR: [
                        { review: null },
                        { review: { notIn: ["ACCEPTED", "REJECTED"] } },
                        { reviewedMinutes: null },
                        { reviewedMinutes: { lt: prisma.attendanceDay.fields.workedMinutes } },
                        { reviewedMinutes: { gt: prisma.attendanceDay.fields.workedMinutes } },
                    ],
                },
                distinct: ["date"],
                orderBy:  { date: "asc" },
                take:     400,
                select:   { date: true },
            }),
        ]);

        const reviewerIds = [...new Set(marks.map((m) => m.reviewedById).filter((v): v is number => v != null))];
        const reviewers = reviewerIds.length
            ? new Map((await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
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
            const worked = m?.workedMinutes ?? 0;
            const holiday = holidayDtos.find((h) => holidayDatesFor([h], branchIdsFrom(u)).size > 0) ?? null;
            const review = m ? reviewOf(m) : null;

            rows.push({
                userId: u.id, name: u.name, avatarUrl: u.avatarUrl, role: u.role,
                kind: !m ? "NONE" : m.source === "OFFICE" ? "OFFICE" : review ? "CLOCK" : "IDLE",
                status: (m?.status as AttendanceStatus | undefined) ?? null,
                firstInAt: m?.firstInAt?.toISOString() ?? null,
                lastOutAt: (m?.lastOutAt ?? m?.lastSeenAt)?.toISOString() ?? null,
                workedMinutes: worked,
                dutyMinutes: duty,
                dutyStart: hours.start,
                dutyEnd: hours.end,
                grade: gradeDay(worked, duty),
                lateBy: lateMinutes(m?.firstInAt ?? null, hours.start, undefined, rules.lateGraceMinutes) ?? 0,
                overtimeMinutes: overtimeMinutes(worked, duty),
                shortMinutes: shortMinutes(worked, duty),
                weeklyOff: (p?.weeklyOff ?? [0]).includes(weekdayOf(date)),
                holidayName: holiday?.name ?? null,
                leaveKind: leaveOf.get(u.id) ?? null,
                note: m?.note ?? null,
                review,
                // Who decided is only worth naming while the decision stands.
                reviewedBy: review === "ACCEPTED" || review === "REJECTED" ? (reviewers.get(m!.reviewedById ?? 0) ?? null) : null,
                reviewedAt: review === "ACCEPTED" || review === "REJECTED" ? (m!.reviewedAt?.toISOString() ?? null) : null,
            });
        }

        const payload: DayReviewPayload = {
            date, today, rows,
            waitingDates: waiting.map((w) => toDateOnlyUtc(w.date)),
        };
        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e, "Failed to read the day");
    }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.HR_ATTENDANCE_EDIT);
    if (response) return response;
    const { data, error } = await validateRequest(req, attendanceReviewSchema);
    if (error) return error;

    // Today is still being worked — its minutes are not final, and a yes given
    // at noon would not cover the afternoon.
    if (data.date >= businessTodayIso()) {
        return NextResponse.json({ error: "Only a finished day can be decided — today is still running." }, { status: 422 });
    }

    try {
        const date = dayOf(data.date);
        const updated = await prisma.$transaction(async (tx) => {
            // Read first: each decision is pinned to the minutes it was made on
            // (`reviewedMinutes`), and Prisma cannot copy one column into another
            // in an update. One row per person, so this stays a staff-sized loop.
            const rows = await tx.attendanceDay.findMany({
                where:  { date, userId: { in: data.decisions.map((d) => d.userId) }, source: "COUNTER", workedMinutes: { gt: 0 } },
                select: { id: true, userId: true, workedMinutes: true },
            });
            const byUser = new Map(rows.map((r) => [r.userId, r]));
            let n = 0;
            for (const d of data.decisions) {
                const row = byUser.get(d.userId);
                if (!row) continue;   // an office mark or an idle row — nothing to decide
                await tx.attendanceDay.update({
                    where: { id: row.id },
                    data: d.review
                        ? { review: d.review, reviewedById: user!.id, reviewedAt: new Date(), reviewedMinutes: row.workedMinutes }
                        : { review: null, reviewedById: null, reviewedAt: null, reviewedMinutes: null },
                });
                n += 1;
            }
            return n;
        });
        return NextResponse.json({ ok: true, updated });
    } catch (e) {
        return handleApiError(e, "Failed to record the decision");
    }
}
