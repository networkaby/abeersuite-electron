// Shared helpers for VoucherSeries reference assembly.
// Used by nextRefFromSeries (server) and the Year Ending UI preview (client).

import { businessToday } from "@/shared/lib/format/formatDate";

export type YearFormat = "CALENDAR" | "CALENDAR_SHORT" | "FY_SHORT" | "FY_SHORT_SLASH" | "FY_LONG";
export type PartName = "type" | "counter" | "year" | "number";

const RESERVED: ReadonlySet<string> = new Set(["type", "counter", "year", "number", "user"]);

export interface SeriesShape {
    typeEnabled: boolean;
    typeValue: string;
    counterEnabled: boolean;
    yearEnabled: boolean;
    yearFormat: string;
    fyStartYear: number | null;
    startFrom: number;
    padWidth: number;
    nextSeq: number;
    partOrder: string;
}

export function formatYear(fyStartYear: number, format: string): string {
    const start = fyStartYear;
    const end = fyStartYear + 1;
    const ss = String(start).slice(-2);
    const es = String(end).slice(-2);
    switch (format) {
        case "CALENDAR": return String(start);
        case "CALENDAR_SHORT": return ss;
        case "FY_SHORT": return `${ss}-${es}`;
        case "FY_SHORT_SLASH": return `${ss}/${es}`;
        case "FY_LONG": return `${start}-${es}`;
        default: return String(start);
    }
}

/** Indian fiscal year start (Apr 1). Returns the calendar year of FY start.
 *
 *  Defaults to the SHOP's day, and reads UTC components — the default and every
 *  caller-supplied date (`new Date("2026-04-01")`) are UTC-pinned. Reading local
 *  parts off those made the first hours of 1 April fall back into the OLD
 *  financial year, so vouchers numbered then got the previous FY's series. */
export function indianFyStartYear(today = businessToday()): number {
    return today.getUTCMonth() < 3 ? today.getUTCFullYear() - 1 : today.getUTCFullYear();
}

/**
 * Returns the FY-start year for `today` given a books restart month/day.
 * If today is before the restart day this calendar year, FY starts last year.
 * restartMonth is 1-12, restartDay is 1-31.
 */
export function fyStartYearFor(restartMonth: number, restartDay: number, today = businessToday()): number {
    const cy = today.getUTCFullYear();
    const restartThisYear = new Date(Date.UTC(cy, restartMonth - 1, restartDay));
    return today < restartThisYear ? cy - 1 : cy;
}

/**
 * Closing date of the FY that started on (fyStartYear, restartMonth, restartDay).
 * It is the day BEFORE the next restart date — UTC midnight.
 */
export function fyClosingDate(fyStartYear: number, restartMonth: number, restartDay: number): Date {
    const nextRestart = Date.UTC(fyStartYear + 1, restartMonth - 1, restartDay);
    return new Date(nextRestart - 86_400_000); // minus 1 day
}

/**
 * First day of the financial year that `today` falls in — UTC midnight.
 *
 * The opening bookend to `fyClosingDate`. Sole source of the "1st day of the
 * current FY" default the Year Ending page prefills its period anchors with,
 * so that default can never drift from the restart day the same page sets.
 */
export function fyStartDate(restartMonth: number, restartDay: number, today = businessToday()): Date {
    const fyStartYear = fyStartYearFor(restartMonth, restartDay, today);
    return new Date(Date.UTC(fyStartYear, restartMonth - 1, restartDay));
}

export type ReferenceContext = { counterNumber?: number | null } | number | null;

/**
 * Assemble the reference string from a series + optional counterNumber.
 * `nextSeq` on the series shape should already be the post-increment value.
 *
 * partOrder is a CSV. Reserved tokens (type/counter/year/number) expand to
 * their values. Anything else is treated as a literal — letting admins
 * embed separators or arbitrary text inline.
 *
 * Counter number is MANDATORY on all vouchers — if no counter is active/passed,
 * it defaults to 1. If counter token is omitted from partOrder, it is
 * automatically prefixed to the number part.
 */
export function assembleReference(s: SeriesShape, ctx?: ReferenceContext): string {
    const fyStart = s.fyStartYear ?? indianFyStartYear();
    const num = s.startFrom + s.nextSeq - 1;
    const rawCounter = typeof ctx === "number" ? ctx : ctx?.counterNumber ?? null;
    const counterNumber = rawCounter != null && rawCounter > 0 ? rawCounter : 1;

    const tokens = s.partOrder.split(",").map((p) => p.trim());
    const hasCounterToken = tokens.some((p) => p === "counter" || p === "user");
    const out: string[] = [];

    for (const part of tokens) {
        if (!RESERVED.has(part)) {
            // Literal text (including separators like "/" or "-").
            // Empty strings drop silently — useful for skipping a separator.
            if (part) out.push(part);
            continue;
        }
        switch (part) {
            case "type":
                if (s.typeEnabled && s.typeValue) {
                    out.push(s.typeValue);
                }
                break;
            case "counter":
            case "user": // backwards compatibility alias for legacy partOrder
                out.push(String(counterNumber));
                break;
            case "year":
                if (s.yearEnabled) {
                    out.push(formatYear(fyStart, s.yearFormat));
                }
                break;
            case "number": {
                const numStr = String(Math.max(0, num)).padStart(s.padWidth, "0");
                // Mandatory counter prefix: if counter token was not standalone in partOrder,
                // prefix counterNumber directly before number.
                if (!hasCounterToken) {
                    out.push(`${counterNumber}${numStr}`);
                } else {
                    out.push(numStr);
                }
                break;
            }
        }
    }

    // No trailing counter prefix here: the loop above has already placed the counter,
    // either as its own `counter`/`user` token or prefixed onto the number part when
    // partOrder omits one. A second prefix would emit it twice.
    return out.join("");
}
