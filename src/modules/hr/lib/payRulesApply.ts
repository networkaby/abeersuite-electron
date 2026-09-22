import "server-only";

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { dutyHoursFor, dutyMinutesFor, gradeDay, lateMinutes, overtimeMinutes, shortMinutes } from "@/shared/lib/hr/dutyTime";
import { loadSeasonalHours } from "@/shared/lib/hr/officeCalendarServer";
import { shopDateFromIso, type SeasonalHours } from "@/shared/lib/hr/seasonalHours";
import { lateDutyCutMinutes, type PayRules } from "@/shared/lib/hr/payRules";
import { perDayPaise, perHourPaise, weekdayOf } from "./payrollProrate";
import type { SalaryLine } from "./salaryLines";

/**
 * The pay rules, applied to one person's attendance over one payroll period.
 *
 * `payrollProrate.ts` answers "what does his structure pay for the days he was
 * employed". This answers the rest of the owner's question — what his CLOCK did
 * to that figure: hours beyond duty, hours still owed, duty on a day the shop
 * was shut, lateness, and an absence nobody granted. The rules themselves are
 * in `shared/lib/hr/payRules.ts`; nothing is decided here, only counted and
 * multiplied.
 *
 * WHAT IS MEASURED AND WHAT IS NOT. Only days the TILL wrote are judged on their
 * minutes. A day the office marked by hand has no honest minute count behind it,
 * and HR's mark overrules the clock everywhere else in this module — it does
 * here too, by being left out of both sides. This is the same rule
 * `monthlyOvertime.ts` follows, deliberately: the figure on the counter's own
 * card and the figure on his payslip must be arrived at the same way.
 *
 * THE NETTING, in the owner's words (2026-09-22): *"monthly overtime is after
 * adjusting the full month. 3 day has less duty total 5h, user has to make up 5h
 * by overtime."* So a day's extra hour is not money on its own — it first pays
 * back the hours he fell short on other days, and only what survives is paid.
 * A day already graded ABSENT or HALF_DAY has had its shortfall taken by payroll
 * once; charging it here as well would dock the same absence twice, so the part
 * payroll has already withheld is excluded.
 */

/** What the clock did to one person's pay, before it is turned into money. */
export interface AttendanceEffect {
    /** Extra minutes that survived the netting — paid at `overtimeRate`. */
    payableMinutes: number;
    /** Minutes still owed after the netting — cut at `shortHoursRate`. */
    owedMinutes: number;
    /** Minutes worked on his own weekly off, and on a listed shop holiday. */
    weeklyOffMinutes: number;
    holidayMinutes: number;
    /** Late days that survived the grace, and those charged after the free ones. */
    lateDays: number;
    chargedLateDays: number;
    /** Days absent with no leave granted for them. */
    unaskedAbsentDays: number;
}

const EMPTY_EFFECT: AttendanceEffect = {
    payableMinutes: 0, owedMinutes: 0, weeklyOffMinutes: 0, holidayMinutes: 0,
    lateDays: 0, chargedLateDays: 0, unaskedAbsentDays: 0,
};

/** The shop-wide reads a whole payroll run shares — fetched once, not per person. */
export interface PayRulesContext {
    rules: PayRules;
    seasonal: SeasonalHours;
    /** ISO date → holiday name, for the period. */
    holidays: Record<string, string>;
}

export async function loadPayRulesContext(rules: PayRules, fromIso: string, toIso: string): Promise<PayRulesContext> {
    const [seasonal, holidays] = await Promise.all([
        loadSeasonalHours(),
        prisma.holiday
            .findMany({
                where: { date: { gte: dateOf(fromIso), lte: dateOf(toIso) } },
                select: { date: true, name: true },
            })
            .then((rows) => Object.fromEntries(rows.map((h) => [iso(h.date), h.name]))),
    ]);
    return { rules, seasonal, holidays };
}

function dateOf(isoDate: string): Date {
    return new Date(`${isoDate}T00:00:00.000Z`);
}

function iso(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/**
 * Count what one person's clock did over [fromIso, toIso].
 *
 * One query for his days and one for the leave that covers them; the holidays
 * and the shop's hours come in on the context, already read for the whole run.
 */
export async function attendanceEffectFor(
    ctx: PayRulesContext,
    userId: number,
    fromIso: string,
    toIso: string,
): Promise<AttendanceEffect> {
    const { rules, seasonal, holidays } = ctx;
    const [profile, rows, leaves] = await Promise.all([
        prisma.staffProfile.findUnique({
            where: { userId },
            select: { dutyMinutes: true, dutyStart: true, dutyEnd: true, weeklyOff: true },
        }),
        prisma.attendanceDay.findMany({
            where: { userId, date: { gte: dateOf(fromIso), lte: dateOf(toIso) } },
            select: { date: true, status: true, source: true, workedMinutes: true, firstInAt: true },
        }),
        prisma.leaveRequest.findMany({
            where: {
                userId,
                status: "APPROVED",
                fromDate: { lte: dateOf(toIso) },
                toDate: { gte: dateOf(fromIso) },
            },
            select: { fromDate: true, toDate: true },
        }),
    ]);
    if (!rows.length) return { ...EMPTY_EFFECT };

    const offDays = new Set(profile?.weeklyOff ?? []);
    const grantedLeave = (day: string) =>
        leaves.some((l) => iso(l.fromDate) <= day && day <= iso(l.toDate));

    /* What was owed on THAT day. Resolved per row rather than once for the
       range, because the shop's opening moves through the year while its closing
       does not — a fixed figure would grade a whole winter month against summer
       hours. A person with hours of their own gets the same answer every day,
       which is what setting them means. Same helper, same reasoning, as
       attendancePayable.ts. */
    const hoursOn = (day: string) =>
        dutyHoursFor(profile?.dutyStart, profile?.dutyEnd, { on: shopDateFromIso(day), seasonal });

    let surplus = 0;
    let shortfall = 0;
    const out: AttendanceEffect = { ...EMPTY_EFFECT };

    /* Late days are charged oldest first, so the free ones are the first of the
       period and not whichever the query happened to return first. */
    const ordered = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());

    for (const r of ordered) {
        const day = iso(r.date);
        const hours = hoursOn(day);
        const duty = dutyMinutesFor(profile?.dutyMinutes, hours.start, hours.end);
        const measured = r.source === "COUNTER" && r.workedMinutes > 0;

        // An absence nobody asked for — charged whichever hand wrote the day,
        // because "he did not come" needs no clock to establish.
        const status = measured ? gradeDay(r.workedMinutes, duty) : r.status;
        if (status === "ABSENT" && !grantedLeave(day)) out.unaskedAbsentDays += 1;

        if (!measured) continue;   // the office's mark stands; nothing to count

        // A day the shop was shut is not part of the netting at all — every
        // minute of it is extra by definition, and paid at its own rate.
        if (holidays[day]) { out.holidayMinutes += r.workedMinutes; continue; }
        if (offDays.has(weekdayOf(day))) { out.weeklyOffMinutes += r.workedMinutes; continue; }

        surplus += overtimeMinutes(r.workedMinutes, duty);

        const short = shortMinutes(r.workedMinutes, duty);
        if (short > 0 && status !== "ABSENT") {
            // Payroll has already withheld half of a half day; only the rest is
            // his debt here, or the same hour is taken from him twice.
            const alreadyWithheld = status === "HALF_DAY" ? Math.round(duty / 2) : 0;
            shortfall += Math.max(0, short - alreadyWithheld);
        }

        // Lateness, against the opening that applied on that very day.
        const late = lateMinutes(r.firstInAt, hours.start, undefined, rules.lateGraceMinutes);
        if (late && late > 0) {
            out.lateDays += 1;
            if (out.lateDays > rules.lateFreeDays) {
                out.chargedLateDays += 1;
                // A time-style penalty is a debt of duty, so it joins the same
                // shortfall his own short days go into — and his overtime can
                // pay it back before anything is cut.
                shortfall += lateDutyCutMinutes(rules, late, duty);
            }
        }
    }

    out.payableMinutes = Math.max(0, surplus - shortfall);
    out.owedMinutes = Math.max(0, shortfall - surplus);
    return out;
}

/**
 * The pay heads the rules add to a person's payslip for the period.
 *
 * Every figure is worked from his BASIC — the owner's rule, "all as per % of
 * basic" — so a man with allowances does not earn overtime on them. A structure
 * with no head named Basic falls back to its whole earnings, which is the only
 * honest reading of "his basic" when nobody has named one.
 *
 * Returned as ordinary `SalaryLine`s so everything downstream — the run, the
 * journal, the payslip, the print template — needs no special case for them.
 */
export function payRuleLines(
    effect: AttendanceEffect,
    rules: PayRules,
    monthlyLines: readonly SalaryLine[],
    payDays: number | null | undefined,
    dutyMinutes: number,
): SalaryLine[] {
    const basic = basicPaiseOf(monthlyLines);
    if (basic <= 0 || dutyMinutes <= 0) return [];

    const perHour = perHourPaise(basic, payDays, dutyMinutes);
    const perDay = perDayPaise(basic, payDays);
    const out: SalaryLine[] = [];

    const earn = (name: string, paise: number) => {
        if (paise >= 1) out.push({ name, kind: "EARNING", amountPaise: Math.round(paise) });
    };
    const deduct = (name: string, paise: number) => {
        if (paise >= 1) out.push({ name, kind: "DEDUCTION", amountPaise: Math.round(paise) });
    };

    earn("Overtime", perHour * rules.overtimeRate * (effect.payableMinutes / 60));
    earn("Weekly off duty", perHour * rules.weeklyOffRate * (effect.weeklyOffMinutes / 60));
    earn("Holiday duty", perHour * rules.holidayRate * (effect.holidayMinutes / 60));

    deduct("Hours owed", perHour * rules.shortHoursRate * (effect.owedMinutes / 60));
    if (rules.latePenaltyStyle === "pay") {
        deduct("Late penalty", perDay * rules.latePenaltyDays * effect.chargedLateDays);
    }
    deduct("Absence penalty", perDay * rules.absentPenaltyDays * effect.unaskedAbsentDays);

    return out;
}

/**
 * His basic for the month: the head named Basic, or every earning when the
 * structure never named one.
 */
export function basicPaiseOf(lines: readonly SalaryLine[]): number {
    const named = lines.find((l) => l.kind === "EARNING" && l.name.trim().toLowerCase() === "basic");
    if (named) return named.amountPaise;
    return lines.reduce((sum, l) => (l.kind === "EARNING" ? sum + l.amountPaise : sum), 0);
}
