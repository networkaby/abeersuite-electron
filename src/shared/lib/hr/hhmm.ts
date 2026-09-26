/**
 * "HH:MM" ↔ minutes past midnight.
 *
 * Its own leaf module for one structural reason: `dutyTime.ts` owns the duty
 * rules and `seasonalHours.ts` owns the curve, and each needs to read a clock
 * time. With the pair living in either of them the two would import each other,
 * and a cycle here is not academic — both modules build constants at load time, so
 * whichever evaluated second would read the other's exports in the temporal dead
 * zone and crash on import. A leaf both can depend on is the fix.
 *
 * Re-exported from `dutyTime.ts`, which is where callers have always found them.
 */

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
