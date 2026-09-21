/**
 * Duty time — how the day's working hours are measured and graded.
 *
 * Every number the rule depends on is here, and nowhere else, because these are
 * the owner's to change and they must not be hunted for across files. Changing
 * one here changes the auto-logout, the register, the payroll factor and the
 * words on screen together.
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

/**
 * No click, no keypress, no touch for this long → signed out, and the stretch is
 * not counted.
 *
 * 45 minutes is a judgement, and the trade is real in both directions. Shorter and
 * a cashier standing at a quiet counter on a slow afternoon gets logged out while
 * genuinely at work, and docked for it. Longer and a real absence is paid. 45 is
 * above any plausible gap between customers and below a tea break, and the person
 * is warned before it fires (see IDLE_WARNING_MS) so it never arrives as a shock.
 */
export const IDLE_LIMIT_MS = 45 * 60 * 1000;

/** Warn this long before the axe, with a way to stay signed in. */
export const IDLE_WARNING_MS = 2 * 60 * 1000;

/**
 * A full day's duty when nobody has set one for the person.
 *
 * Nine hours, read off the shop's own shifts rather than picked as a round number:
 * the closed shifts on live run 8h50m to 10h47m, clustered around nine and a half.
 * Per-person duty (StaffProfile.dutyMinutes) overrides it — an office hand and a
 * counter hand do not owe the same day.
 */
export const DEFAULT_DUTY_MINUTES = 9 * 60;

/** At or above this share of duty, the day is full. */
export const FULL_DAY_FRACTION = 0.75;
/** At or above this share (but under full), the day is half. */
export const HALF_DAY_FRACTION = 0.40;

/** The person's duty for one day, in minutes. */
export function dutyMinutesFor(profileDutyMinutes: number | null | undefined): number {
    return profileDutyMinutes && profileDutyMinutes > 0 ? profileDutyMinutes : DEFAULT_DUTY_MINUTES;
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
 * How much of the gap since the last sign of life counts as work.
 *
 * The client pings every few minutes while somebody is actually using the machine,
 * and each ping adds the gap since the previous one. A gap longer than the idle
 * limit means they were NOT here for it — the session had already died, or the app
 * sat untouched — so it adds nothing and a fresh span starts. This is the whole of
 * "treat the idle time as absent", and it holds whether or not the auto-logout
 * actually fired: a machine left on all night simply contributes one ignored gap.
 */
export function creditableMinutes(previousSeenAt: Date | null, now: Date): number {
    if (!previousSeenAt) return 0;
    const gapMs = now.getTime() - previousSeenAt.getTime();
    if (gapMs <= 0 || gapMs > IDLE_LIMIT_MS) return 0;
    return Math.round(gapMs / 60000);
}
