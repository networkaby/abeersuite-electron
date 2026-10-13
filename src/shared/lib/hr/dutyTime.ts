/**
 * Duty time — how the day's working hours are measured and graded.
 *
 * The numbers the rule depends on — duty hours, grace, the full/half-day shares
 * and the idle limit — are the owner's to change, so they live with the other
 * settings in `shared/lib/constants/hr.ts` and `constants/session.ts`. Changing
 * one there changes the auto-logout, the register, the payroll factor and the
 * words on screen together. This file holds the rules that read them.
 *
 * The model, in the owner's words (2026-09-22): a person signs in, works, and if
 * they leave the counter the idle timer runs out and signs them out — and THAT
 * IDLE STRETCH IS NOT DUTY. Working time is the active spans added up, so several
 * logins in a day sum correctly and a forgotten sign-out costs nothing.
 *
 *   in 10:30 … last touch 14:00, signed out 14:45  →  3h 30m   (45m idle unpaid)
 *   in 16:00 … shift closed 20:40                  →  4h 40m
 *   day total                                        8h 10m    → full day
 *
 * A manual mark from the office ALWAYS wins over any of this. The grading below
 * only ever answers for a day the till wrote and nobody has overruled.
 */

import { parseHhMm } from "./hhmm";
import { seasonalStartFor, type SeasonalHours, type ShopDate } from "./seasonalHours";
import {
    DEFAULT_DUTY_END, DEFAULT_DUTY_MINUTES, DEFAULT_DUTY_START, FULL_DAY_FRACTION, HALF_DAY_FRACTION, LATE_GRACE_MINUTES,
} from "@/shared/lib/constants/hr";
import { DEFAULT_IDLE_LIMIT_MINUTES, IDLE_LIMIT_MS, MAX_IDLE_LIMIT_MINUTES } from "@/shared/lib/constants/session";
import { BUSINESS_TIME_ZONE } from "@/shared/lib/constants/business";

/**
 * How long THIS person may be away before they are signed out — and before the
 * gap stops counting as duty.
 *
 * Owner, 2026-09-22: *"suppose counter manager need to be at counter every time
 * but a technician not. it's not same for everyone."* A till manager away from
 * the counter for twenty minutes is a real absence; a technician with his head in
 * a machine, or out on a job, is working the whole time and must not be docked
 * for it. One number could only ever be wrong for one of them.
 */
export function idleLimitMinutesFor(profileIdleLimitMinutes: number | null | undefined): number {
    const m = profileIdleLimitMinutes;
    if (!m || m <= 0) return DEFAULT_IDLE_LIMIT_MINUTES;
    return Math.min(m, MAX_IDLE_LIMIT_MINUTES);
}

/** The same, in milliseconds. */
export function idleLimitMsFor(profileIdleLimitMinutes: number | null | undefined): number {
    return idleLimitMinutesFor(profileIdleLimitMinutes) * 60 * 1000;
}

/** Clock-time parsing lives in `hhmm.ts`; re-exported so callers find it here. */
export { parseHhMm, formatHhMm } from "./hhmm";

/**
 * The person's office hours, falling back to the shop's.
 *
 * This is the one place office hours are resolved — the attendance API, the
 * register, payroll, `dutyMinutesFor` and the staff editor all arrive here — which
 * is why the season enters the system through this function and nowhere else.
 * Widening it was the whole of making the shop's hours seasonal: every caller got
 * it for free, and `dutyMinutesFor` reading the SPAN means a shorter winter day
 * shrinks duty on its own, with no second number to keep in step.
 *
 * `opts.on` is the day being asked about and `opts.seasonal` the shop's configured
 * anchors; with neither, the shop's flat defaults answer exactly as before. A
 * person's own typed hours still win outright — somebody on a fixed shift does not
 * follow the sun.
 */
export function dutyHoursFor(
    start: string | null | undefined,
    end: string | null | undefined,
    opts?: { on?: Date | ShopDate; seasonal?: SeasonalHours },
): { start: string; end: string } {
    const seasonal = opts?.seasonal;
    return {
        start: parseHhMm(start) !== null
            ? start!.trim()
            : seasonal ? seasonalStartFor(opts?.on ?? new Date(), seasonal) : DEFAULT_DUTY_START,
        end: parseHhMm(end) !== null
            ? end!.trim()
            : seasonal?.end ?? DEFAULT_DUTY_END,
    };
}

/**
 * The person's duty for one day, in minutes.
 *
 * A typed figure wins — that is the override for a day with an unpaid break in
 * it, where the office hours overstate what is owed. Otherwise it is simply the
 * length of their office hours, so setting 10:30–20:30 sets a ten-hour day and
 * there is no second number to keep in step. An end before the start is a night
 * shift crossing midnight and wraps.
 */
export function dutyMinutesFor(
    profileDutyMinutes: number | null | undefined,
    start?: string | null,
    end?: string | null,
): number {
    if (profileDutyMinutes && profileDutyMinutes > 0) return profileDutyMinutes;
    const hours = dutyHoursFor(start, end);
    const from = parseHhMm(hours.start), to = parseHhMm(hours.end);
    if (from === null || to === null) return DEFAULT_DUTY_MINUTES;
    const span = to > from ? to - from : 24 * 60 - from + to;
    return span > 0 ? span : DEFAULT_DUTY_MINUTES;
}

/**
 * How late the arrival was, in minutes — 0 when on time or inside the grace.
 *
 * Null when there is nothing to judge: no arrival recorded at all. The arrival is
 * a UTC instant and the office hours are shop-clock, so the comparison is made in
 * shop time; doing it in UTC would call everybody five and a half hours late.
 */
export function lateMinutes(
    firstInAt: Date | string | null,
    startHhMm: string,
    timeZone = BUSINESS_TIME_ZONE,
    /* The shop's own grace, once it has one. LATE_GRACE_MINUTES is only the
       fallback for a caller that has not read the pay rules — see
       shared/lib/hr/payRules.ts, `lateGraceMinutes`. */
    graceMinutes: number = LATE_GRACE_MINUTES,
): number | null {
    if (!firstInAt) return null;
    const at = typeof firstInAt === "string" ? new Date(firstInAt) : firstInAt;
    if (Number.isNaN(at.getTime())) return null;
    const start = parseHhMm(startHhMm);
    if (start === null) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const arrived = get("hour") * 60 + get("minute");
    const late = arrived - start - Math.max(0, graceMinutes);
    return late > 0 ? late : 0;
}

/**
 * How early the day was left, in minutes — 0 when they stayed to closing or past it.
 *
 * The mirror of `lateMinutes`, and it exists for the same reason: a short day and
 * an early finish are two different failings, and a card that only says "6h of 9h
 * worked" cannot tell you which one happened. No grace: leaving early is a choice
 * in a way that arriving late in traffic is not, and the shop can forgive it by
 * eye. Null when there is no departure to judge — a day still running, or one
 * nobody recorded.
 */
export function earlyMinutes(
    lastOutAt: Date | string | null,
    endHhMm: string,
    timeZone = BUSINESS_TIME_ZONE,
): number | null {
    if (!lastOutAt) return null;
    const at = typeof lastOutAt === "string" ? new Date(lastOutAt) : lastOutAt;
    if (Number.isNaN(at.getTime())) return null;
    const end = parseHhMm(endHhMm);
    if (end === null) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const leftAt = get("hour") * 60 + get("minute");
    const early = end - leftAt;
    return early > 0 ? early : 0;
}

export type DutyGrade = "PRESENT" | "HALF_DAY" | "ABSENT";

/**
 * Full, half or absent, from the minutes actually worked.
 *
 * On a nine-hour duty that is 6h45m for a full day and 3h36m for a half. Deliberately
 * a fraction of duty rather than fixed hours: a part-timer on a four-hour duty who
 * works all four has done a full day, and a fixed 6h45m rule would call it half.
 */
export function gradeDay(workedMinutes: number, dutyMinutes: number): DutyGrade {
    if (dutyMinutes <= 0) return "ABSENT";
    const share = workedMinutes / dutyMinutes;
    if (share >= FULL_DAY_FRACTION) return "PRESENT";
    if (share >= HALF_DAY_FRACTION) return "HALF_DAY";
    return "ABSENT";
}

/** "8h 10m", "45m" — for the register cell and the day's tooltip. */
export function formatWorked(minutes: number): string {
    if (minutes <= 0) return "0m";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/**
 * How much of the gap since the last sign of life counts as work, and whether the
 * gap meant the person was away.
 *
 * The client pings every few minutes while somebody is actually using the machine,
 * and each ping adds the gap since the previous one. A gap longer than the idle
 * limit means they were NOT here for it — the session had already died, or the app
 * sat untouched — so it adds nothing and a fresh span starts. This is the whole of
 * "treat the idle time as absent", and it holds whether or not the auto-logout
 * actually fired: a machine left on all night simply contributes one ignored gap.
 */
export function creditStep(previousSeenAt: Date | null, now: Date, idleLimitMs = IDLE_LIMIT_MS): CreditStep {
    if (!previousSeenAt) return { minutes: 0, seenAt: now, away: true };
    const gapMs = now.getTime() - previousSeenAt.getTime();
    if (gapMs <= 0) return { minutes: 0, seenAt: previousSeenAt, away: false };
    if (gapMs > idleLimitMs) return { minutes: 0, seenAt: now, away: true };
    // Whole minutes only, and the clock moves on by exactly what was credited.
    // Owner, 2026-10-13: rounding each beat on its own threw away up to half a
    // minute a time — and a beat inside 30 s rounded to 0, which read as "away"
    // and broke the stretch into 0m pieces. The leftover seconds now wait for
    // the next beat instead of being lost.
    const minutes = Math.floor(gapMs / 60000);
    return { minutes, seenAt: new Date(previousSeenAt.getTime() + minutes * 60000), away: false };
}

/**
 * One beat's answer: the minutes to add, where the day's clock now stands, and
 * whether the gap was long enough to mean the person was not there. `away` — not
 * `minutes === 0` — is what ends a stretch; a quick second beat credits nothing
 * and is still the same stretch.
 */
export interface CreditStep {
    minutes: number;
    seenAt: Date;
    away: boolean;
}

/**
 * Overtime for ONE day: time worked above the duty he is paid for.
 *
 * Owner, 2026-09-22: *"time above paid duty is called over time for the day."*
 * Deliberately measured against his duty MINUTES, not against the duty END clock:
 * a man who came in at noon and worked till eleven has done his hours, and a rule
 * reading "after 20:30" would hand him overtime for being late.
 */
export function overtimeMinutes(workedMinutes: number, dutyMinutes: number): number {
    const over = workedMinutes - dutyMinutes;
    return over > 0 ? over : 0;
}

/**
 * The other side of the same coin: duty owed but not worked.
 *
 * This is the "absent from duty during duty hours" figure on the counter's own
 * card — the idle stretches and the late arrival, already netted out, because
 * neither was ever credited to `workedMinutes` in the first place. A day is
 * either over or short, never both.
 */
export function shortMinutes(workedMinutes: number, dutyMinutes: number): number {
    const short = dutyMinutes - workedMinutes;
    return short > 0 ? short : 0;
}

