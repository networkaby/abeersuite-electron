// ── Calendar interval math ────────────────────────────────────────────────────
// One helper for every "date + N units" in the app. Two callers today:
//   • worker retry schedule — TicketWorker.retrySchedule phases ({unit, every, times})
//   • recurring tasks       — TaskRecurrence.{unit, every} anchor arithmetic
// Both speak the same vocabulary, so they share the same math.

export type IntervalUnit = "minute" | "hour" | "day" | "week" | "month" | "year";

/** Channels, densest → sparsest. Drives the worker "Attempts" rows and the
 *  recurring-task repeat dropdown (which filters out minute/hour). */
export const INTERVAL_UNITS = [
    { key: "minute", label: "Minute", abbr: "m" },
    { key: "hour", label: "Hour", abbr: "h" },
    { key: "day", label: "Day", abbr: "d" },
    { key: "week", label: "Week", abbr: "w" },
    { key: "month", label: "Month", abbr: "mo" },
    { key: "year", label: "Year", abbr: "y" },
] as const satisfies readonly { key: IntervalUnit; label: string; abbr: string }[];

/** Last calendar day of the month `month` (0-11) in `year`. */
function lastDayOfMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
}

/**
 * `from` + (every × unit), calendar-correct — not 30/365-day approximations.
 *
 * Month and year steps CLAMP the day to the target month's last day, because
 * the naive `setMonth` overflows: 31 Jan + 1 month lands on 3 March, not
 * 28 February. That is harmless for a retry snooze but wrong for "rent on the
 * 31st", so we clamp for both.
 *
 * Clamping is applied to the RESULT only — callers that step from a fixed
 * anchor (`anchor + n months`) therefore recover the anchor's day-of-month in
 * the next long month instead of drifting earlier for ever.
 *
 * `every` may be negative (step backwards) or 0 (returns a copy of `from`).
 */
export function addInterval(from: Date, unit: IntervalUnit | string, every: number): Date {
    const d = new Date(from);
    switch (unit) {
        case "minute": d.setMinutes(d.getMinutes() + every); break;
        case "hour": d.setHours(d.getHours() + every); break;
        case "day": d.setDate(d.getDate() + every); break;
        case "week": d.setDate(d.getDate() + every * 7); break;
        case "month": setMonthClamped(d, d.getMonth() + every); break;
        case "year": setMonthClamped(d, d.getMonth() + every * 12); break;
        // Unknown unit — fall back to minutes, same as the original retry helper.
        default: d.setMinutes(d.getMinutes() + every);
    }
    return d;
}

/** Move `d` to absolute month index `targetMonth` (may be <0 or >11 — Date
 *  normalises the year), clamping the day so it never spills into the next month. */
function setMonthClamped(d: Date, targetMonth: number): void {
    const day = d.getDate();
    d.setDate(1); // park on a day every month has, so setMonth cannot overflow
    d.setMonth(targetMonth);
    d.setDate(Math.min(day, lastDayOfMonth(d.getFullYear(), d.getMonth())));
}
