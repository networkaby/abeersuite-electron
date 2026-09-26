/**
 * HR rules — the shop's numbers for duty time, lateness and the pay month.
 *
 * Two kinds live here:
 *   • FALLBACKS — duty start / end, the full-day length and the pay days. A
 *     person's own StaffProfile value, or the shop's seasonal hours on screen,
 *     wins when it is set; these answer only when nothing is.
 *   • THE LIVE VALUE — TRACK_OFF_COUNTER, the full / half-day shares and the leave
 *     year have no screen. What is written here is what everyone gets.
 * Late grace is both: see LATE_GRACE_MINUTES.
 *
 * The idle sign-out (which also stops the duty clock) is in `session.ts`.
 */

/**
 * Is duty time counted for people who are NOT on a counter PC?
 *
 * The activity pulse is mounted for every signed-in staff member, so the moment
 * this is true an office hand working on the website starts accruing a measured,
 * auto-graded day — and that day reaches payroll. Switching that on for everyone
 * at once, on a feature that has not yet run for a single real day, is a large
 * change to make silently.
 *
 * So it starts FALSE: tills only, where the shifts give a second independent
 * record to check the minutes against. Turn it on once a counter has been watched
 * for a day and the numbers look right — it is this one constant, nothing else.
 */
export const TRACK_OFF_COUNTER = false;

/**
 * The shop's own hours, as "HH:MM" in shop time — when duty starts and ends.
 *
 * Two jobs: they say who is LATE, and they give the length of a full day when
 * nobody has typed one. Defaults read off the real shifts on live, which open
 * 10:30–12:20 and close 20:30–22:18. Per person on StaffProfile; per season on
 * OrgDefaults (see `hr/seasonalHours.ts`).
 */
export const DEFAULT_DUTY_START = "10:30";
export const DEFAULT_DUTY_END = "20:30";

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
 * Arriving within this of the start is not late.
 *
 * Not indulgence — precision. A clock that calls 10:31 late makes the whole
 * column noise, and a column of noise gets ignored, which is worse than not
 * having it. Fifteen minutes marks the people who are actually late.
 *
 * Also the default for the grace on HR → Pay Rules (DEFAULT_PAY_RULES). Once the
 * shop saves its own grace there, payroll and the hours breakup use that saved
 * number, while the Attendance register and the till's "My Day" still read this
 * one — so keep the two the same until the register reads Pay Rules too.
 */
export const LATE_GRACE_MINUTES = 15;

/** At or above this share of duty, the day is full. */
export const FULL_DAY_FRACTION = 0.75;
/** At or above this share (but under full), the day is half. */
export const HALF_DAY_FRACTION = 0.40;

/**
 * The government month: how many days a monthly salary is taken to buy.
 *
 * Every divisor in HR comes through `payDaysOf` (hr/lib/payrollProrate.ts) —
 * payroll, the hourly rate behind overtime, and the per-day figure the salary
 * dialog shows — so the number cannot drift apart between the sheet and the screen.
 */
export const DEFAULT_PAY_DAYS = 26;

/**
 * The leave year runs 1 April → 31 March, the same year the books keep. A quota
 * is spent inside one of these, and 1 April starts everyone at nothing taken.
 */
export const LEAVE_YEAR_START_MONTH = 4;
