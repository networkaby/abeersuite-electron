/**
 * Seasonal office hours — when the shop opens, as the year moves.
 *
 * Assam runs on IST like the rest of India, but its sun does not. Guwahati sees
 * first light around 4:30 in June and not until 6:05 in January, and with no
 * daylight saving anywhere in the country the clock never absorbs that swing. A
 * single fixed opening time is therefore wrong for half the year in one direction
 * and half in the other: the shop opens in the dark all winter, or hours after the
 * town is already awake all summer. The tea gardens solved this a century ago with
 * their own "bagan time"; this is the same idea, done in minutes rather than a
 * flat hour.
 *
 * Owner, 2026-09-22: the OPENING moves, the CLOSING does not. So a winter day is
 * genuinely shorter than a summer day, and that is intended — it is not an error
 * to be corrected by lengthening the evening.
 *
 * ── The curve ────────────────────────────────────────────────────────────────
 * A cosine between two anchors, one at each solstice:
 *
 *     start = mid + amp × cos( 2π × (dayOfYear − 355) / 365.25 )
 *
 * Not a straight line between four seasonal slabs, because a slab jumps: staff
 * arrive on a Monday to find the rule moved fifteen minutes overnight, and the day
 * that changed is always somebody's late mark. The cosine is flat near the
 * solstices and steepest at the equinoxes — which is how sunrise itself moves — so
 * the shift is never more than about a minute every three days, small enough that
 * nobody has to be told and nobody is caught out.
 *
 * Both anchors equal ⇒ amp is 0 ⇒ a flat line at that time. That is the default,
 * and it is why switching this on changes nothing until somebody sets a winter
 * anchor that differs from the summer one.
 */

import { formatHhMm, parseHhMm } from "./hhmm";

/** The shop clock. Office hours are civil times in this zone, never UTC. */
export const SHOP_TIME_ZONE = "Asia/Kolkata";

/**
 * Day-of-year of the December solstice — the cosine's peak, i.e. the latest opening.
 *
 * 21 December in a common year. Held as a constant rather than computed from the
 * real solstice instant: the true moment wanders about a day and a quarter across
 * the leap cycle, which would move every opening time in the year by seconds for
 * no gain anyone could see.
 */
const WINTER_SOLSTICE_DOY = 355;

/** The length of the cycle. The quarter-day is what keeps leap years from drifting. */
const YEAR_LENGTH = 365.25;

/**
 * The shop's hours as the owner sets them: two anchors and a closing time.
 *
 * `summerStart` and `winterStart` are the openings at the two solstices; every
 * other day of the year falls between them on the curve. `end` is fixed.
 */
export interface SeasonalHours {
    /** Opening at the June solstice — the earliest of the year. "HH:MM". */
    summerStart: string;
    /** Opening at the December solstice — the latest of the year. "HH:MM". */
    winterStart: string;
    /** Closing time, the same all year. "HH:MM". */
    end: string;
}

/**
 * The shop's own hours, as "HH:MM" in shop time — when duty starts and ends.
 *
 * Two jobs: they say who is LATE, and they give the length of a full day when
 * nobody has typed one. Defaults read off the real shifts on live, which open
 * 10:30–12:20 and close 20:30–22:18. Per person on StaffProfile; per season on
 * OrgDefaults.
 *
 * These live here rather than in dutyTime.ts — where they were until seasonal
 * hours arrived — because the fallback below has to be built from them at load
 * time, and dutyTime importing this module means this one cannot import back
 * without a cycle. `dutyTime.ts` re-exports them, so callers still find them where
 * they always have, and there is still exactly one definition.
 */
export const DEFAULT_DUTY_START = "10:30";
export const DEFAULT_DUTY_END = "20:30";

/**
 * What the shop runs on when nothing has been configured.
 *
 * Both anchors are DEFAULT_DUTY_START, so the curve is flat and the behaviour is
 * bit-for-bit what it was before seasonal hours existed.
 */
export const SHOP_SEASONAL_FALLBACK: SeasonalHours = {
    summerStart: DEFAULT_DUTY_START,
    winterStart: DEFAULT_DUTY_START,
    end: DEFAULT_DUTY_END,
};

/** A civil date in the shop's zone — what "today" means to the shop, not to UTC. */
export interface ShopDate {
    year: number;
    month: number;
    /** Day of the month, 1-31. */
    day: number;
    /** 0 = Sunday … 6 = Saturday, matching StaffProfile.weeklyOff. */
    weekday: number;
    /** "YYYY-MM-DD". */
    iso: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * An instant → the civil date the shop was living in at that instant.
 *
 * Needed because an instant near midnight is a different date in IST than in UTC,
 * and every rule here — which day of the year it is, whether it is the weekly off —
 * is about the shop's day. The same reasoning as `lateMinutes` converting before it
 * compares.
 */
export function shopDateOf(at: Date = new Date(), timeZone = SHOP_TIME_ZONE): ShopDate {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const year = Number(get("year"));
    const month = Number(get("month"));
    const day = Number(get("day"));
    return {
        year, month, day,
        weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
        iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
}

/** "YYYY-MM-DD" → the same civil date, with its weekday worked out. */
export function shopDateFromIso(iso: string): ShopDate {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (!m) return shopDateOf();
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    // Noon UTC, so the civil date is the same one in every zone the shop could be in.
    const at = new Date(Date.UTC(year, month - 1, day, 12));
    return { year, month, day, weekday: at.getUTCDay(), iso: `${m[1]}-${m[2]}-${m[3]}` };
}

/** The civil date `days` after this one. */
export function addShopDays(date: ShopDate, days: number): ShopDate {
    const at = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
    return {
        year: at.getUTCFullYear(),
        month: at.getUTCMonth() + 1,
        day: at.getUTCDate(),
        weekday: at.getUTCDay(),
        iso: at.toISOString().slice(0, 10),
    };
}

/** 1 for 1 January, 365 or 366 for 31 December. */
export function dayOfYear(date: ShopDate): number {
    const start = Date.UTC(date.year, 0, 1);
    const here = Date.UTC(date.year, date.month - 1, date.day);
    return Math.round((here - start) / 86_400_000) + 1;
}

/**
 * The opening time for one day, as "HH:MM".
 *
 * Exact to the minute — the owner's call. Rounding to five or fifteen would settle
 * into slabs and throw away the whole point of computing it daily, and there is no
 * cost to the precision: a person reads one time on one screen and the register
 * measures lateness from the same number.
 */
export function seasonalStartFor(
    on: Date | ShopDate = new Date(),
    cfg: SeasonalHours = SHOP_SEASONAL_FALLBACK,
): string {
    const date = on instanceof Date ? shopDateOf(on) : on;
    const summer = parseHhMm(cfg.summerStart);
    const winter = parseHhMm(cfg.winterStart);
    // Either anchor unreadable — fall back rather than invent a curve from one point.
    if (summer === null || winter === null) return SHOP_SEASONAL_FALLBACK.summerStart;
    if (summer === winter) return formatHhMm(summer);

    const mid = (summer + winter) / 2;
    const amp = (winter - summer) / 2;
    const phase = (2 * Math.PI * (dayOfYear(date) - WINTER_SOLSTICE_DOY)) / YEAR_LENGTH;
    return formatHhMm(Math.round(mid + amp * Math.cos(phase)));
}

/** Both extremes plus today — what the settings screen previews before saving. */
export function seasonalExtremes(cfg: SeasonalHours, today: Date = new Date()) {
    return {
        summer: seasonalStartFor(shopDateFromIso(`${shopDateOf(today).year}-06-21`), cfg),
        winter: seasonalStartFor(shopDateFromIso(`${shopDateOf(today).year}-12-21`), cfg),
        today: seasonalStartFor(today, cfg),
    };
}

/** Why a day was passed over on the way to the next working one. */
export type ClosedReason = "weekly-off" | "holiday";

export interface ClosedDay {
    iso: string;
    weekday: number;
    why: ClosedReason;
    /** The holiday's name, when that is why. */
    name?: string;
}

export interface NextOfficeDay {
    /** "YYYY-MM-DD" of the next day the shop is open. */
    iso: string;
    weekday: number;
    /** That day's opening, already on the curve. "HH:MM". */
    startHhMm: string;
    /** Closing, which does not move. "HH:MM". */
    endHhMm: string;
    /** Days passed over to get there, in order — empty when it is simply tomorrow. */
    skipped: ClosedDay[];
}

export interface OfficeCalendar {
    /** Closed days of the week, 0 = Sunday. */
    weeklyOff?: number[];
    /** Holidays as "YYYY-MM-DD" → name. */
    holidays?: Record<string, string>;
    seasonal?: SeasonalHours;
}

/**
 * How far ahead to look before giving up.
 *
 * A fortnight is past any real run of holidays; beyond that the calendar is
 * misconfigured — every weekday marked off, say — and walking a year to prove it
 * would just hang the screen. Returning the last day looked at, with the skips
 * that got there, tells the truth without pretending to an answer.
 */
const MAX_LOOKAHEAD_DAYS = 14;

/**
 * The next day the shop is open, and what time it opens.
 *
 * This is the whole answer the sign-out screen needs: not "tomorrow" — which is
 * wrong on a Thursday before a Friday off, and wrong again the night before Bihu —
 * but the real next working day, with the days in between and the reason for each,
 * so the screen can say *why* it is not tomorrow.
 *
 * Starts from the day AFTER `from`: the question is always asked by somebody who
 * has just finished today.
 */
export function nextOfficeDay(
    from: Date | ShopDate = new Date(),
    calendar: OfficeCalendar = {},
): NextOfficeDay {
    const seasonal = calendar.seasonal ?? SHOP_SEASONAL_FALLBACK;
    const weeklyOff = new Set(calendar.weeklyOff ?? []);
    const holidays = calendar.holidays ?? {};
    const start = from instanceof Date ? shopDateOf(from) : from;

    const skipped: ClosedDay[] = [];
    let day = addShopDays(start, 1);

    for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
        const holidayName = holidays[day.iso];
        // A holiday is named even when it lands on a weekly off — "closed Sunday"
        // and "closed for Bihu" are different sentences, and the named one is the
        // one worth showing.
        if (holidayName !== undefined) {
            skipped.push({ iso: day.iso, weekday: day.weekday, why: "holiday", name: holidayName });
        } else if (weeklyOff.has(day.weekday)) {
            skipped.push({ iso: day.iso, weekday: day.weekday, why: "weekly-off" });
        } else {
            return {
                iso: day.iso,
                weekday: day.weekday,
                startHhMm: seasonalStartFor(day, seasonal),
                endHhMm: seasonal.end,
                skipped,
            };
        }
        day = addShopDays(day, 1);
    }

    return {
        iso: day.iso,
        weekday: day.weekday,
        startHhMm: seasonalStartFor(day, seasonal),
        endHhMm: seasonal.end,
        skipped,
    };
}
