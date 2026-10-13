import "server-only";

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { dutyHoursFor, dutyMinutesFor, gradeDay, lateMinutes, overtimeMinutes, shortMinutes } from "@/shared/lib/hr/dutyTime";
import { loadSeasonalHours } from "@/shared/lib/hr/officeCalendarServer";
import { shopDateFromIso, type SeasonalHours } from "@/shared/lib/hr/seasonalHours";
import {
    EMPTY_ATTENDANCE_EFFECT, lateDutyCutMinutes, pendingTotal, walkPendingDuty,
    type AttendanceEffect, type PayRules, type PendingDay, type PendingDayInput, type PendingItem,
} from "@/shared/lib/hr/payRules";
import { ATTENDANCE_SOURCE_SELECT, autoCounts, lateOf, workedOf } from "@/shared/lib/hr/attendanceSource";
import { perHourPaise, weekdayOf } from "./payrollProrate";
import type { SalaryLine } from "./salaryLines";
import { holidayDatesFor } from "./attendanceCalendar";
import { userBranchIds } from "./staffBranchesServer";

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
 * PENDING DUTY, in the owner's words (2026-10-13): *"after no previous duty
 * due, extra counted to overtime"*, *"all penalties go to pending"*. Walked day
 * by day in `walkPendingDuty`: a day's extra first makes up the duty pending from
 * earlier days, and only what is left is that day's overtime. What is still
 * pending at the end of the period is cut once.
 * A day already graded ABSENT or HALF_DAY has had its shortfall taken by payroll
 * once; charging it here as well would dock the same absence twice, so the part
 * payroll has already withheld is excluded.
 */

// `AttendanceEffect` itself lives in `shared/lib/hr/payRules.ts`, beside the
// rules that produce it, so a screen can show these figures without importing a
// server-only module.

/** The shop-wide reads a whole payroll run shares — fetched once, not per person. */
export interface PayRulesContext {
    rules: PayRules;
    seasonal: SeasonalHours;
    /** Every holiday in the period, org-wide and per branch; narrowed per person. */
    holidays: { id: number; date: string; name: string; branchId: string | null }[];
}

export async function loadPayRulesContext(rules: PayRules, fromIso: string, toIso: string): Promise<PayRulesContext> {
    const [seasonal, holidays] = await Promise.all([
        loadSeasonalHours(),
        prisma.holiday
            .findMany({
                where: { date: { gte: dateOf(fromIso), lte: dateOf(toIso) } },
                select: { id: true, date: true, name: true, branchId: true },
            })
            .then((rows) => rows.map((h) => ({ id: h.id, date: iso(h.date), name: h.name, branchId: h.branchId }))),
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
    return (await attendanceLedgerFor(ctx, userId, fromIso, toIso)).effect;
}

/** The effect, plus each day's pending-duty walk — what the day cards show. */
export async function attendanceLedgerFor(
    ctx: PayRulesContext,
    userId: number,
    fromIso: string,
    toIso: string,
): Promise<{ effect: AttendanceEffect; days: PendingDay[] }> {
    const { rules, seasonal } = ctx;
    const [profile, rows, leaves, branchIds] = await Promise.all([
        prisma.staffProfile.findUnique({
            where: { userId },
            select: { dutyMinutes: true, dutyStart: true, dutyEnd: true, weeklyOff: true },
        }),
        prisma.attendanceDay.findMany({
            where: { userId, date: { gte: dateOf(fromIso), lte: dateOf(toIso) } },
            select: { date: true, status: true, firstInAt: true, ...ATTENDANCE_SOURCE_SELECT },
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
        userBranchIds(userId),
    ]);
    if (!rows.length) return { effect: { ...EMPTY_ATTENDANCE_EFFECT }, days: [] };
    const holidays = holidayDatesFor(ctx.holidays, branchIds);

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

    const out: AttendanceEffect = { ...EMPTY_ATTENDANCE_EFFECT };
    const ledger: PendingDayInput[] = [];

    /* Late days are charged oldest first, so the free ones are the first of the
       period and not whichever the query happened to return first. */
    const ordered = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());

    for (const r of ordered) {
        const day = iso(r.date);
        const hours = hoursOn(day);
        const duty = dutyMinutesFor(profile?.dutyMinutes, hours.start, hours.end);
        // Auto pays on the activity card's minutes — corrected where a person
        // fixed them; manual pays on the mark. attendanceSource.ts.
        const measured = autoCounts(r);
        const worked = workedOf(r);
        const adds: PendingItem[] = [];
        let extra = 0;

        // An absence nobody asked for — charged whichever hand wrote the day,
        // because "he did not come" needs no clock to establish. The day itself
        // is paid at zero by payroll; only the penalty goes to pending duty.
        const status = measured ? gradeDay(worked, duty, rules) : r.status;
        if (status === "ABSENT" && !grantedLeave(day)) {
            out.unaskedAbsentDays += 1;
            adds.push({ date: day, kind: "absent", minutes: Math.round(duty * rules.absentPenaltyDays) });
        }

        if (measured) {
            // A day the shop was shut is outside pending duty — every minute of it
            // is extra by definition, and paid at its own rate.
            if (holidays.has(day)) { out.holidayMinutes += worked; continue; }
            if (offDays.has(weekdayOf(day))) { out.weeklyOffMinutes += worked; continue; }

            const over = overtimeMinutes(worked, duty);
            extra = over;

            const short = shortMinutes(worked, duty);
            if (short > 0 && status !== "ABSENT") {
                // Payroll has already withheld half of a half day; only the rest
                // is pending here, or the same hour is taken from him twice.
                const alreadyWithheld = status === "HALF_DAY" ? Math.round(duty / 2) : 0;
                adds.push({ date: day, kind: "short", minutes: Math.max(0, short - alreadyWithheld) });
            }

            // Lateness, against the opening that applied on that very day.
            const late = lateOf(r, lateMinutes(r.firstInAt, hours.start, undefined, rules.lateGraceMinutes) ?? 0);
            if (late > 0) {
                out.lateDays += 1;
                if (out.lateDays > rules.lateFreeDays) {
                    out.chargedLateDays += 1;
                    // The day's own extra pays the penalty first; only what it
                    // cannot cover is carried as short.
                    const cut = lateDutyCutMinutes(rules, late, duty);
                    const covered = Math.min(over, cut);
                    extra = over - covered;
                    adds.push({ date: day, kind: "late", minutes: cut - covered });
                }
            }
        }
        ledger.push({ date: day, extra, adds });
    }

    const days = walkPendingDuty(ledger);
    out.payableMinutes = days.reduce((t, d) => t + d.overtime, 0);
    out.owedMinutes = pendingTotal(days[days.length - 1]?.after ?? []);
    return { effect: out, days };
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

    // Every penalty — late and absence — is already inside the pending duty, in
    // hours (owner, 2026-10-13), so this one line is the whole of the cut.
    deduct("Pending duty", perHour * rules.shortHoursRate * (effect.owedMinutes / 60));

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
