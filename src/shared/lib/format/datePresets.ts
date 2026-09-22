// Named stretches of time — "this month", "last month", "today" — as plain ISO
// dates, in one place.
//
// Every screen with a date range grew its own copy of this arithmetic: the
// accountancy registers had one, the HR screens were about to write another. The
// sums are trivial and that is exactly why they drift — one screen's "this week"
// starting on Sunday and another's on Monday is the kind of difference nobody
// notices until two reports disagree.
//
// A financial year is not here: it needs the fiscal-year rules that live with
// accountancy, and HR has no use for one. That module keeps its own `thisFY`
// case and hands everything else to this function.
//
// Pure, and takes today as an argument, so a caller on the server can hand it
// `businessTodayIso()` (the shop's own day, not the server's) and a caller in
// the browser can hand it `todayIso()`. Nothing here reads a clock by itself.

import { todayIso } from "./formatDate";

export type DatePresetKey =
    | "today"
    | "yesterday"
    | "last7"
    | "thisWeek"
    | "thisMonth"
    | "lastMonth"
    | "custom";

/** The label each preset wears in a picker. Custom is the caller's own words. */
export const DATE_PRESET_LABELS: Record<DatePresetKey, string> = {
    today:     "Today",
    yesterday: "Yesterday",
    last7:     "Last 7 days",
    thisWeek:  "This week",
    thisMonth: "This month",
    lastMonth: "Last month",
    custom:    "Custom",
};

/**
 * The range a preset stands for, ending today rather than at the end of the
 * period: a month that has not finished has no business showing a fortnight of
 * empty days, and a card per empty day is worse still.
 *
 * "Last month" is the one exception — it IS over, so it runs the whole month.
 *
 * The week starts on Monday, which is how a shop's week reads when Sunday is the
 * weekly off. `custom` returns empty strings: only the caller knows what the
 * person typed.
 */
export function presetRangeOf(p: DatePresetKey, today: string = todayIso()): { from: string; to: string } {
    const t = new Date(`${today}T00:00:00.000Z`);
    const f = (d: Date) => d.toISOString().slice(0, 10);
    const shift = (days: number) => { const d = new Date(t); d.setUTCDate(d.getUTCDate() + days); return d; };
    const monthStart = (delta: number) => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + delta, 1));

    switch (p) {
        case "today":     return { from: today, to: today };
        case "yesterday": { const d = f(shift(-1)); return { from: d, to: d }; }
        case "last7":     return { from: f(shift(-6)), to: today };
        // Monday of the current week. getUTCDay() is 0 on Sunday, which belongs
        // to the week that has just ended, not the one starting tomorrow.
        case "thisWeek":  return { from: f(shift(-((t.getUTCDay() + 6) % 7))), to: today };
        case "thisMonth": return { from: f(monthStart(0)), to: today };
        case "lastMonth": {
            const start = monthStart(-1);
            const end = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
            return { from: f(start), to: f(end) };
        }
        default:          return { from: "", to: "" };
    }
}
