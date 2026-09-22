// Reading the hours breakup out of the database — the server half of
// attendanceBreakup.ts, which does the arithmetic.
//
// One person, one date range. Deliberately not "everybody, every day": the spans
// are the finest-grained table in the system and a month of the whole shop would
// be thousands of rows to answer a question nobody asked. The register already
// gives the shop-wide view in totals; this is the drill-down behind one name.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { businessTodayIso, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { dutyHoursFor, dutyMinutesFor, lateMinutes } from "@/shared/lib/hr/dutyTime";
import { loadSeasonalHours } from "@/shared/lib/hr/officeCalendarServer";
import { loadPayRules } from "@/modules/hr/lib/payRulesServer";
import { shopDateFromIso } from "@/shared/lib/hr/seasonalHours";
import { isoDaysBetween } from "@/modules/hr/lib/attendanceCalendar";
import { buildDayBreakup, type DayBreakup, type SpanDto } from "@/modules/hr/lib/attendanceBreakup";
import type { HoursPayload } from "@/modules/hr/lib/attendanceHoursTypes";

const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export async function loadHoursBreakup(userId: number, from: string, to: string): Promise<HoursPayload | null> {
    const [user, seasonal, rules, dayRows, spanRows] = await Promise.all([
        prisma.user.findUnique({
            where:  { id: userId },
            select: {
                id: true, name: true,
                staffProfile: { select: { dutyMinutes: true, dutyStart: true, dutyEnd: true, joinedOn: true, leftOn: true } },
            },
        }),
        loadSeasonalHours(),
        loadPayRules(),
        prisma.attendanceDay.findMany({
            where:  { userId, date: { gte: dayOf(from), lte: dayOf(to) } },
            select: { date: true, status: true, source: true, firstInAt: true, lastSeenAt: true, workedMinutes: true },
        }),
        prisma.attendanceSpan.findMany({
            where:   { userId, date: { gte: dayOf(from), lte: dayOf(to) } },
            orderBy: { startedAt: "asc" },
            select:  { date: true, startedAt: true, endedAt: true, minutes: true, counterId: true, endedBy: true },
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

    const today = businessTodayIso();
    const joined = user.staffProfile?.joinedOn ? toDateOnlyUtc(user.staffProfile.joinedOn) : null;
    const left   = user.staffProfile?.leftOn   ? toDateOnlyUtc(user.staffProfile.leftOn)   : null;

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

        days.push(buildDayBreakup({
            date: iso,
            isToday: iso === today,
            // No spans means the day predates this record, or nothing was measured
            // on it. Either way the breakup has nothing honest to show and says so.
            tracked: spans.length > 0,
            spans,
            lastSeenAt: row?.lastSeenAt?.toISOString() ?? null,
            workedMinutes: row?.workedMinutes ?? 0,
            dutyMinutes: duty,
            lateBy: lateMinutes(row?.firstInAt ?? null, hours.start, undefined, rules.lateGraceMinutes) ?? 0,
            status: row?.status ?? "",
            manual: row?.source === "OFFICE",
        }));
    }

    return { userId: user.id, userName: user.name, from, to, days };
}
