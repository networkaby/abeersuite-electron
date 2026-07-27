// Reusable period parsing for Tally reports.
// Indian fiscal year: Apr 1 → Mar 31. asOf defaults to "now"; ranges default to current FY.
//
// Boundaries are pinned to UTC midnight (`startOfDayUtc` / `endOfDayUtc`)
// because every column these ranges filter — `UniversalVoucher.date`,
// `InvStockLedger.date` — is `@db.Date`, which Postgres compares by calendar
// date. A LOCAL-midnight bound is one day early in IST (local 27 Jul 00:00 is
// 26 Jul 18:30 UTC, truncating to the 26th), which made every report silently
// include the day before its start date. Pinning to UTC also makes the result
// identical on a dev machine in IST and a server running UTC.
import { startOfDayUtc, endOfDayUtc, toDateOnly } from "@/shared/lib/format/formatDate";

export type PeriodRange = { from: Date; to: Date };

/** 1 April of the fiscal year containing `today`, at UTC midnight.
 *
 *  Reads UTC components, and the default argument converts "now" from the
 *  local calendar day to its UTC-midnight equivalent first — so both callers
 *  work: one passing an already UTC-pinned bound (parseAsOf), and one passing
 *  nothing. Without that, an asOf of 31 Mar 23:59:59Z would read as 1 Apr in
 *  IST and jump a whole fiscal year. */
export function indianFiscalYearStart(today = startOfDayUtc(new Date())): Date {
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth(); // Jan = 0, Apr = 3
    const fyYear = m < 3 ? y - 1 : y;
    return new Date(Date.UTC(fyYear, 3, 1, 0, 0, 0, 0));
}

export function parseAsOf(searchParams: URLSearchParams): Date {
    const v = searchParams.get("asOf");
    return endOfDayUtc(v ?? new Date());
}

export function parseRange(searchParams: URLSearchParams): PeriodRange {
    const fromParam = searchParams.get("from");
    const toParam   = searchParams.get("to");
    return {
        from: fromParam ? startOfDayUtc(fromParam) : indianFiscalYearStart(),
        to:   endOfDayUtc(toParam ?? new Date()),
    };
}

/** Format a Date as yyyy-mm-dd using local calendar components (NOT UTC). */
export function formatDateInput(d: Date): string {
    return toDateOnly(d);
}
