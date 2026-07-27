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

// ── Query boundaries for Postgres DATE columns ──────────────────────────────
//
// `UniversalVoucher.date`, `InvStockLedger.date` etc. are `@db.Date` — a plain
// calendar date with NO time. Postgres truncates whatever timestamp you compare
// against them down to a date.
//
// So a boundary built at LOCAL midnight is wrong east of UTC: in IST, local
// midnight on 27 Jul is 26 Jul 18:30 UTC, which truncates to **26 Jul** — the
// window silently starts a day early and a report for "27th" also returns the
// 26th. (West of UTC the same flaw lands on the `to` end instead.) Pinning the
// boundary to UTC midnight makes it land exactly on the intended date literal,
// on any server, in any timezone.
//
// Use these ONLY for date-column query bounds. For form inputs and display,
// `parseIsoDateOnly` / `toDateOnly` (local components) remain correct.

const isoParts = (d: string | Date): [number, number, number] => {
    if (d instanceof Date) return [d.getFullYear(), d.getMonth(), d.getDate()];
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(d);
    if (!m) {
        const p = new Date(d);
        return [p.getFullYear(), p.getMonth(), p.getDate()];
    }
    return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
};

/** First instant of the given calendar day, as a DATE-column-safe bound. */
export function startOfDayUtc(d: string | Date): Date {
    const [y, m, day] = isoParts(d);
    return new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
}

/** Last instant of the given calendar day, as a DATE-column-safe bound. */
export function endOfDayUtc(d: string | Date): Date {
    const [y, m, day] = isoParts(d);
    return new Date(Date.UTC(y, m, day, 23, 59, 59, 999));
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

// ── Business-timezone "today", for SERVER code ──────────────────────────────
//
// `todayIso()` above is correct in the BROWSER, where "local" means the shop's
// own clock. On the server it is wrong: Vercel Functions run in UTC regardless
// of where the shop is, so `new Date()` there reads server time, not shop time.
// Between 00:00 and 05:30 IST a server-side "today" would stamp a voucher with
// YESTERDAY's date.
//
// `TZ` can't fix this — Vercel reserves that env-var name, so it can't be set
// per-project. Intl needs no such setting: it computes calendar parts for any
// named zone directly, on any server, regardless of the server's own clock.
//
// Single named constant so a future multi-region shop is a one-line change,
// not a re-grep of every call site.
const BUSINESS_TIME_ZONE = "Asia/Kolkata";

/** Today as yyyy-mm-dd in the SHOP's timezone — for server code stamping a
 *  voucher/order/refund date from "now". Never use `todayIso()` /
 *  `new Date().toISOString()` server-side for this; both read the wrong clock. */
export function businessTodayIso(): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: BUSINESS_TIME_ZONE,
        year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
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
