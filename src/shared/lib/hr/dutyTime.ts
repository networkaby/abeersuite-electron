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
export const DEFAULT_IDLE_LIMIT_MINUTES = 45;

/** The default as milliseconds, for anyone with no personal limit set. */
export const IDLE_LIMIT_MS = DEFAULT_IDLE_LIMIT_MINUTES * 60 * 1000;

/**
 * The longest a personal limit may be, in minutes.
 *
 * The session itself ends after SESSION_IDLE_MAX_AGE_MS (6 hours) no matter what
 * — that backstop exists for a machine with the app shut, where no client-side
 * timer is running at all. A personal limit above it would be a promise this code
 * cannot keep: the session would go first and the person would be signed out
 * earlier than their own setting said. So it is capped, and the cap is honest.
 */
export const MAX_IDLE_LIMIT_MINUTES = 6 * 60;

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

/**
 * The shop's own hours, as "HH:MM" in shop time — when duty starts and ends.
 *
 * Two jobs: they say who is LATE, and they give the length of a full day when
 * nobody has typed one. Defaults read off the real shifts on live, which open
 * 10:30–12:20 and close 20:30–22:18. Per person on StaffProfile.
 */
export const DEFAULT_DUTY_START = "10:30";
export const DEFAULT_DUTY_END = "20:30";

/**
 * Arriving within this of the start is not late.
 *
 * Not indulgence — precision. A clock that calls 10:31 late makes the whole
 * column noise, and a column of noise gets ignored, which is worse than not
 * having it. Fifteen minutes marks the people who are actually late.
 */
export const LATE_GRACE_MINUTES = 15;

/** "HH:MM" → minutes past midnight, or null if it is not a time. */
export function parseHhMm(hhmm: string | null | undefined): number | null {
    if (!hhmm) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

/** Minutes past midnight → "HH:MM". */
export function formatHhMm(minutes: number): string {
    const h = Math.floor(minutes / 60) % 24;
    return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The person's office hours, falling back to the shop's. */
export function dutyHoursFor(start: string | null | undefined, end: string | null | undefined): { start: string; end: string } {
    return {
        start: parseHhMm(start) !== null ? start!.trim() : DEFAULT_DUTY_START,
        end:   parseHhMm(end) !== null ? end!.trim() : DEFAULT_DUTY_END,
    };
}

/** At or above this share of duty, the day is full. */
export const FULL_DAY_FRACTION = 0.75;
/** At or above this share (but under full), the day is half. */
export const HALF_DAY_FRACTION = 0.40;

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
export function lateMinutes(firstInAt: Date | string | null, startHhMm: string, timeZone = "Asia/Kolkata"): number | null {
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
    const late = arrived - start - LATE_GRACE_MINUTES;
    return late > 0 ? late : 0;
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
export function creditableMinutes(previousSeenAt: Date | null, now: Date, idleLimitMs = IDLE_LIMIT_MS): number {
    if (!previousSeenAt) return 0;
    const gapMs = now.getTime() - previousSeenAt.getTime();
    if (gapMs <= 0 || gapMs > idleLimitMs) return 0;
    return Math.round(gapMs / 60000);
}
