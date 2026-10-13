// Reading the hours breakup out of the database — the server half of
// attendanceBreakup.ts, which does the arithmetic.
//
// One person, one date range. Deliberately not "everybody, every day": the spans
// are the finest-grained table in the system and a month of the whole shop would
// be thousands of rows to answer a question nobody asked. The register already
// gives the shop-wide view in totals; this is the drill-down behind one name.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { businessTodayIso, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { dutyHoursFor, dutyMinutesFor, idleLimitMinutesFor, lateMinutes } from "@/shared/lib/hr/dutyTime";
import { loadSeasonalHours } from "@/shared/lib/hr/officeCalendarServer";
import { loadPayRules } from "@/modules/hr/lib/payRulesServer";
import { lateDutyCutMinutes } from "@/shared/lib/hr/payRules";
import { ATTENDANCE_SOURCE_SELECT, autoCounts, lateOf, workedOf } from "@/shared/lib/hr/attendanceSource";
import { shopDateFromIso } from "@/shared/lib/hr/seasonalHours";
import { holidayDatesFor, isoDaysBetween, weekdayOf } from "@/modules/hr/lib/attendanceCalendar";
import { attendanceLedgerFor } from "@/modules/hr/lib/payRulesApply";
import { userBranchIds } from "@/modules/hr/lib/staffBranchesServer";
import { buildDayBreakup, type DayBreakup, type SpanDto } from "@/modules/hr/lib/attendanceBreakup";
import type { HoursPayload } from "@/modules/hr/lib/attendanceHoursTypes";

const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * `clockOnly`: judge every day on the till's minutes, Manual or Auto — the
 * Employee Activity view. Payroll's own read leaves it off, so a Manual day
 * there still pays on the office's mark.
 */
export async function loadHoursBreakup(
    userId: number, from: string, to: string, opts: { clockOnly?: boolean } = {},
): Promise<HoursPayload | null> {
    const clockOnly = !!opts.clockOnly;
    const [user, seasonal, rules, dayRows, spanRows, holidayRows, branchIds, leaveRows] = await Promise.all([
        prisma.user.findUnique({
            where:  { id: userId },
            select: {
                id: true, name: true,
                staffProfile: { select: { dutyMinutes: true, dutyStart: true, dutyEnd: true, joinedOn: true, leftOn: true, weeklyOff: true, idleLimitMinutes: true } },
            },
        }),
        loadSeasonalHours(),
        loadPayRules(),
        prisma.attendanceDay.findMany({
            where:  { userId, date: { gte: dayOf(from), lte: dayOf(to) } },
            select: { date: true, status: true, firstInAt: true, lastSeenAt: true, note: true, manualStatus: true, ...ATTENDANCE_SOURCE_SELECT },
        }),
        prisma.attendanceSpan.findMany({
            where:   { userId, date: { gte: dayOf(from), lte: dayOf(to) } },
            orderBy: { startedAt: "asc" },
            select:  { date: true, startedAt: true, endedAt: true, minutes: true, counterId: true, endedBy: true },
        }),
        // The days the shop was shut. Needed twice over: to name a holiday on its
        // own card, and to hand the netting the same list payroll would use.
        prisma.holiday.findMany({
            where:  { date: { gte: dayOf(from), lte: dayOf(to) } },
            select: { id: true, date: true, name: true, branchId: true },
        }),
        userBranchIds(userId),
        // The leave granted over these days. The status already says LEAVE; this
        // says WHICH leave, which is the part a person asks about.
        prisma.leaveRequest.findMany({
            where: {
                userId, status: "APPROVED",
                fromDate: { lte: dayOf(to) }, toDate: { gte: dayOf(from) },
            },
            select: { fromDate: true, toDate: true, kind: true },
        }),
    ]);
    if (!user) return null;

    const dayByIso = new Map(dayRows.map((d) => [toDateOnlyUtc(d.date), d]));
    const spansByIso = new Map<string, SpanDto[]>();
    for (const s of spanRows) {
        const iso = toDateOnlyUtc(s.date);
        const list = spansByIso.get(iso) ?? [];
        list.push({
            startedAt: s.startedAt.toISOString(),
            endedAt:   s.endedAt?.toISOString() ?? null,
            minutes:   s.minutes,
            counterId: s.counterId,
            endedBy:   s.endedBy as SpanDto["endedBy"],
        });
        spansByIso.set(iso, list);
    }

    const holidays = holidayRows.map((h) => ({ id: h.id, date: toDateOnlyUtc(h.date), name: h.name, branchId: h.branchId }));
    // A branch holiday belongs to the people who hold a seat there; one with no
    // branch is everybody's.
    const myHolidays = new Map(
        holidays.filter((h) => holidayDatesFor([h], branchIds).size > 0).map((h) => [h.date, h.name]),
    );
    const offDays = new Set(user.staffProfile?.weeklyOff ?? []);
    const leaveKindOn = (iso: string): string | null =>
        leaveRows.find((l) => toDateOnlyUtc(l.fromDate) <= iso && iso <= toDateOnlyUtc(l.toDate))?.kind ?? null;

    const today = businessTodayIso();
    const idleLimit = idleLimitMinutesFor(user.staffProfile?.idleLimitMinutes);
    const joined = user.staffProfile?.joinedOn ? toDateOnlyUtc(user.staffProfile.joinedOn) : null;
    const left   = user.staffProfile?.leftOn   ? toDateOnlyUtc(user.staffProfile.leftOn)   : null;

    // Late days are charged oldest first, so the free ones are the first of the
    // range and not whichever the loop happens to reach first — the same order
    // `attendanceEffectFor` uses, or the card and the payslip would disagree
    // about which day was the free one.
    let lateSoFar = 0;

    const days: DayBreakup[] = [];
    for (const iso of isoDaysBetween(from, to)) {
        // Before joining or after leaving is not their day at all — an empty row
        // there would read as an absence, which is the one thing it is not.
        if (joined && iso < joined) continue;
        if (left && iso > left) continue;

        const row = dayByIso.get(iso);
        const spans = spansByIso.get(iso) ?? [];

        // The day's own hours: the shop's opening moves through the year, so
        // December genuinely owes less than June. A person with hours of their own
        // resolves to the same figure every day, which is the point of setting them.
        const hours = dutyHoursFor(user.staffProfile?.dutyStart, user.staffProfile?.dutyEnd, {
            on: shopDateFromIso(iso), seasonal,
        });
        const duty = dutyMinutesFor(user.staffProfile?.dutyMinutes, hours.start, hours.end);

        // The clock's lateness, and the one the day stands on — a correction
        // made on the card wins (attendanceSource.ts).
        const tillLate = lateMinutes(row?.firstInAt ?? null, hours.start, undefined, rules.lateGraceMinutes) ?? 0;
        const lateBy = row ? lateOf(row, tillLate) : tillLate;
        const weeklyOff = offDays.has(weekdayOf(iso));
        const holidayName = myHolidays.get(iso) ?? null;
        // Exactly the days `attendanceEffectFor` judges, and no others: a day the
        // office typed has no honest minute count behind it, and a day the shop
        // was shut cannot be arrived late for. Counting one of those here would
        // spend a free late day the payslip never spent, and from then on every
        // later day would disagree with payroll about whether it was charged.
        // The clock's own record: Manual or Auto, every day with minutes is
        // judged here (owner, 2026-10-13) — the same `clockOnly` walk below.
        const judged = !!row && (clockOnly ? workedOf(row) > 0 : autoCounts(row)) && !weeklyOff && !holidayName;
        let lateCharged = false;
        if (lateBy > 0 && judged) {
            lateSoFar += 1;
            lateCharged = lateSoFar > rules.lateFreeDays;
        }

        days.push(buildDayBreakup({
            date: iso,
            isToday: iso === today,
            // No spans means the day predates this record, or nothing was measured
            // on it. Either way the breakup has nothing honest to show and says so.
            tracked: spans.length > 0,
            spans,
            lastSeenAt: row?.lastSeenAt?.toISOString() ?? null,
            idleLimitMinutes: idleLimit,
            workedMinutes: row ? workedOf(row) : 0,
            dutyMinutes: duty,
            lateBy,
            dutyStart: hours.start,
            dutyEnd: hours.end,
            note: row?.note ?? null,
            leaveKind: leaveKindOn(iso),
            status: row?.status ?? "",
            manual: row?.source === "OFFICE",
            till: { workedMinutes: row?.workedMinutes ?? 0, lateBy: tillLate },
            corrected: { worked: row?.overrideWorkedMinutes != null, late: row?.overrideLateMinutes != null },
            manualStatus: row?.manualStatus ?? null,
            weeklyOff,
            holidayName,
            // The rule's own function, not a second copy of it.
            latePenaltyMinutes: lateCharged ? lateDutyCutMinutes(rules, lateBy, duty) : 0,
            lateCharged,
            gradeLimits: rules,
        }));
    }

    // The pending-duty walk is payroll's own, run here rather than re-derived:
    // overtime only counts once the duty pending from earlier days is made up,
    // and a screen that worked it out by itself would promise more than the
    // payslip pays. The reads it would make for the context are ones we have
    // already done, so it is handed them rather than repeating them.
    const { effect, days: ledger } = await attendanceLedgerFor({ rules, seasonal, holidays }, userId, from, to, { clockOnly });
    // Each card carries its own line of the walk — pending carried in, made up,
    // overtime, added — so the card and the payslip are one calculation.
    const pendingByIso = new Map(ledger.map((p) => [p.date, p]));
    for (const d of days) d.pending = pendingByIso.get(d.date) ?? null;

    return {
        userId: user.id, userName: user.name, from, to, days, rules, effect,
        idleLimitMinutes: idleLimit,
    };
}
