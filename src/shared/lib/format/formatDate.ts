export function formatDate(d: Date | string): string {
    return new Date(d).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
    });
}

/** ISO 8601 yyyy-mm-dd using local calendar components (NOT UTC). */
export function toDateOnly(d: Date | string): string {
    const dt = d instanceof Date ? d : new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Parse an ISO yyyy-mm-dd date-only string into a LOCAL midnight Date.
 *  JS's `new Date("YYYY-MM-DD")` parses it as UTC midnight, which rolls
 *  back a calendar day in timezones east of UTC (IST, etc.) — this helper
 *  guarantees the local calendar components round-trip exactly. */
export function parseIsoDateOnly(iso: string): Date {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(iso);
    if (!m) return new Date(iso);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Compare two dates as calendar dates (yyyy-mm-dd strings) — timezone-safe.
 *  Returns true when a <= b at the calendar-day level. */
export function dateOnOrBefore(a: Date | string, b: Date | string): boolean {
    return toDateOnly(a) <= toDateOnly(b);
}

/** True when two values fall on the same calendar day (local components). */
export function isSameDay(a: Date | string, b: Date | string): boolean {
    return toDateOnly(a) === toDateOnly(b);
}

/** Today as yyyy-mm-dd (local calendar, not UTC). */
export function todayIso(): string {
    return toDateOnly(new Date());
}

export function formatDateTime(d: Date | string): string {
    return new Date(d).toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
}

/**
 * Smart inbox/chat timestamp.
 * Same day → HH:MM (locale time). Older → "Mon DD".
 * Handles Supabase Realtime payloads that may omit the trailing "Z" — coerces to UTC.
 */
export function formatInboxTime(iso: string): string {
    const utc = iso && !iso.endsWith("Z") && !iso.includes("+") ? iso + "Z" : iso;
    const date = new Date(utc);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Time only (HH:MM AM/PM, en-US). */
export function formatTimeOnly(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}
