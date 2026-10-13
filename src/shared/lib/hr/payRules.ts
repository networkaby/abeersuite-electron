/**
 * Pay Rules — how time turns into money, for the whole shop.
 *
 * One set of rules, stored once on `OrgDefaults.hrPayRulesJson`, read by the
 * Pay Rules screen and (next) by the payroll run. Every figure here is a
 * MULTIPLE or a COUNT, never a rupee: a basic is per person and lives on the
 * staff record, so one rule fits every salary and a revision changes nothing
 * here.
 *
 * "His normal hour" throughout means the rate `payrollProrate.perHourPaise`
 * gives — his own basic ÷ payDays ÷ the duty he owes in a day. There is no
 * second definition of it anywhere.
 *
 * The owner's words, 2026-09-22, which these rules are written from:
 *   • "over time hourly cost 1.5x, weekend attendance price, late joining
 *      penalty — all as per % of basic"
 *   • "make it 1.5 instead of 150"
 *   • "we can also impose other type of penalty — reduce hour of the day by
 *      late minute x penalty, 5 minute late x 2, 10% of the day hours deducted"
 *   • "not flat % — its late dependent"
 *   • "absent without granted leave penalty, minimum leave application time
 *      before the leave day"
 */

import { FULL_DAY_FRACTION, HALF_DAY_FRACTION, LATE_GRACE_MINUTES } from "@/shared/lib/constants/hr";

/**
 * How a charged late day is punished.
 *
 * Money is the blunt one — a slice of the day's basic straight off the payslip.
 * Time is the lighter hand: it does not touch the payslip at all, it shortens
 * the duty the day is credited with. That shortfall then goes through the
 * machinery that already exists — it eats his overtime first, and only what is
 * still owed at month end meets `shortHoursRate`. So a man who works the time
 * back is not punished twice.
 *
 * One style is in force at a time. Money AND time for the same late day would
 * be two punishments for one offence.
 */
export type LatePenaltyStyle = "none" | "pay" | "timesLate" | "sharePerSlab" | "shareOfDay";

export interface PayRules {
    // ── Day grade ────────────────────────────────────────────────────────────
    /** Worked at least this % of the day's duty → full day (present). */
    fullDayPct: number;
    /** Worked at least this % (but under full) → half day. Below it → absent. */
    halfDayPct: number;

    // ── Overtime ─────────────────────────────────────────────────────────────
    /** Each extra hour is paid this many times his normal hour. */
    overtimeRate: number;
    /** Each hour still owed at month end is cut at this many times. 0 forgives. */
    shortHoursRate: number;

    // ── Weekly off & holidays ────────────────────────────────────────────────
    /** An hour worked on his own weekly off, as a multiple of the normal hour. */
    weeklyOffRate: number;
    /** An hour worked on a listed shop holiday, same. */
    holidayRate: number;

    // ── Absence & leave notice ───────────────────────────────────────────────
    /**
     * Days of basic cut for an absence nobody granted — ON TOP of the day
     * itself, which payroll already pays at zero. 0 means the day costs only
     * itself.
     */
    absentPenaltyDays: number;
    /**
     * Days of notice a leave application should carry. Short notice is not a
     * bar — sickness gives no notice — it only marks the application late.
     */
    leaveNoticeDays: number;

    // ── Late arrival ─────────────────────────────────────────────────────────
    /** Signing in within this many minutes of opening is not counted late. */
    lateGraceMinutes: number;
    /** The first N late days of a month cost nothing. */
    lateFreeDays: number;
    /** Which of the charges below is in force. */
    latePenaltyStyle: LatePenaltyStyle;
    /** "pay": days of basic off the payslip, per charged late day. */
    latePenaltyDays: number;
    /** "timesLate": the minutes late are counted this many times over. */
    lateTimesLate: number;
    /** "sharePerSlab": this % of the day's duty for every `lateSlabMinutes`. */
    lateSlabPct: number;
    lateSlabMinutes: number;
    /** "shareOfDay": this % of the day's duty, flat, whatever the lateness. */
    lateSharePct: number;
}

/**
 * What the shop runs on until somebody changes it.
 *
 * Deliberately gentle where a default can hurt: no money penalty for lateness
 * (the minutes are already lost), a quarter-hour of grace and two free late
 * days a month. The one sharp default is the absence penalty, because an
 * absence nobody asked for is the thing the owner wanted charged.
 */
export const DEFAULT_PAY_RULES: PayRules = {
    fullDayPct: Math.round(FULL_DAY_FRACTION * 100),
    halfDayPct: Math.round(HALF_DAY_FRACTION * 100),
    overtimeRate: 1.5,
    shortHoursRate: 1,
    weeklyOffRate: 2,
    holidayRate: 2,
    absentPenaltyDays: 1,
    leaveNoticeDays: 3,
    lateGraceMinutes: LATE_GRACE_MINUTES,
    lateFreeDays: 2,
    latePenaltyStyle: "timesLate",
    latePenaltyDays: 1,
    lateTimesLate: 2,
    lateSlabPct: 10,
    lateSlabMinutes: 5,
    lateSharePct: 10,
};

const STYLES: readonly LatePenaltyStyle[] = ["none", "pay", "timesLate", "sharePerSlab", "shareOfDay"];

/** A stored number made safe: anything absurd falls back to the default. */
function num(v: unknown, fallback: number, max: number): number {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) return fallback;
    return v;
}

/**
 * Defensive read of the JSON column — a malformed or half-written row yields
 * the defaults for the fields it cannot answer, never a crash and never a
 * `NaN` that would reach somebody's payslip.
 */
export function parsePayRules(v: unknown): PayRules {
    if (!v || typeof v !== "object") return { ...DEFAULT_PAY_RULES };
    const r = v as Record<string, unknown>;
    const d = DEFAULT_PAY_RULES;
    const fullDayPct = num(r.fullDayPct, d.fullDayPct, 100);
    return {
        fullDayPct,
        // A half-day bar above the full-day bar would make half days impossible.
        halfDayPct:        Math.min(num(r.halfDayPct, d.halfDayPct, 100), fullDayPct),
        overtimeRate:      num(r.overtimeRate, d.overtimeRate, 10),
        shortHoursRate:    num(r.shortHoursRate, d.shortHoursRate, 10),
        weeklyOffRate:     num(r.weeklyOffRate, d.weeklyOffRate, 10),
        holidayRate:       num(r.holidayRate, d.holidayRate, 10),
        absentPenaltyDays: num(r.absentPenaltyDays, d.absentPenaltyDays, 31),
        leaveNoticeDays:   num(r.leaveNoticeDays, d.leaveNoticeDays, 90),
        lateGraceMinutes:  num(r.lateGraceMinutes, d.lateGraceMinutes, 240),
        lateFreeDays:      num(r.lateFreeDays, d.lateFreeDays, 31),
        latePenaltyStyle:  STYLES.includes(r.latePenaltyStyle as LatePenaltyStyle)
            ? (r.latePenaltyStyle as LatePenaltyStyle)
            : d.latePenaltyStyle,
        latePenaltyDays:   num(r.latePenaltyDays, d.latePenaltyDays, 31),
        lateTimesLate:     num(r.lateTimesLate, d.lateTimesLate, 20),
        lateSlabPct:       num(r.lateSlabPct, d.lateSlabPct, 100),
        lateSlabMinutes:   num(r.lateSlabMinutes, d.lateSlabMinutes, 240),
        lateSharePct:      num(r.lateSharePct, d.lateSharePct, 100),
    };
}

/**
 * Minutes of duty a single late day loses, beyond the lateness itself.
 *
 * Only the TIME styles answer here; "pay" and "none" cost no duty and return 0.
 * The cut can never exceed the day, however late he was and however small the
 * slab.
 *
 * A part slab counts as a whole one — 12 minutes late against a 5-minute slab
 * is three slabs, not two and a bit. Rounding the other way would make the
 * first minutes of every slab free, and the rule is meant to push him towards
 * the shutter, not towards the next round number.
 */
export function lateDutyCutMinutes(rules: PayRules, lateMinutes: number, dutyMinutes: number): number {
    if (lateMinutes <= 0 || dutyMinutes <= 0) return 0;
    switch (rules.latePenaltyStyle) {
        case "timesLate":
            return Math.min(dutyMinutes, Math.round(lateMinutes * rules.lateTimesLate));
        case "sharePerSlab": {
            if (rules.lateSlabMinutes <= 0 || rules.lateSlabPct <= 0) return 0;
            const slabs = Math.ceil(lateMinutes / rules.lateSlabMinutes);
            const pct = Math.min(100, slabs * rules.lateSlabPct);
            return Math.min(dutyMinutes, Math.round((dutyMinutes * pct) / 100));
        }
        case "shareOfDay":
            return Math.min(dutyMinutes, Math.round((dutyMinutes * rules.lateSharePct) / 100));
        default:
            return 0;
    }
}

/**
 * What one person's clock did to their pay over a period, before it is turned
 * into money.
 *
 * It lives here, beside the rules that produce it, rather than in the server
 * module that counts it — a screen showing the figures must be able to name
 * their shape without dragging Prisma into the browser bundle.
 */
export interface AttendanceEffect {
    /** Extra minutes that survived the netting — paid at `overtimeRate`. */
    payableMinutes: number;
    /** Minutes still owed after the netting — cut at `shortHoursRate`. */
    owedMinutes: number;
    /** Minutes worked on their own weekly off, and on a listed shop holiday. */
    weeklyOffMinutes: number;
    holidayMinutes: number;
    /** Late days that survived the grace, and those charged after the free ones. */
    lateDays: number;
    chargedLateDays: number;
    /** Days absent with no leave granted for them. */
    unaskedAbsentDays: number;
}

/** A period in which the clock did nothing at all. */
export const EMPTY_ATTENDANCE_EFFECT: AttendanceEffect = {
    payableMinutes: 0, owedMinutes: 0, weeklyOffMinutes: 0, holidayMinutes: 0,
    lateDays: 0, chargedLateDays: 0, unaskedAbsentDays: 0,
};

/** Days of basic a single charged late day costs. Only the "pay" style charges. */
export function latePayCutDays(rules: PayRules): number {
    return rules.latePenaltyStyle === "pay" ? rules.latePenaltyDays : 0;
}
