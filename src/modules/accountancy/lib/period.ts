// Reusable period parsing for Tally reports.
// Indian fiscal year: Apr 1 → Mar 31. asOf defaults to "now"; ranges default to current FY.
import { parseIsoDateOnly, toDateOnly } from "@/shared/lib/format/formatDate";

export type PeriodRange = { from: Date; to: Date };

export function indianFiscalYearStart(today = new Date()): Date {
    const y = today.getFullYear();
    const m = today.getMonth(); // Jan = 0, Apr = 3
    const fyYear = m < 3 ? y - 1 : y;
    return new Date(fyYear, 3, 1, 0, 0, 0, 0);
}

export function parseAsOf(searchParams: URLSearchParams): Date {
    const v = searchParams.get("asOf");
    const d = v ? parseIsoDateOnly(v) : new Date();
    d.setHours(23, 59, 59, 999);
    return d;
}

export function parseRange(searchParams: URLSearchParams): PeriodRange {
    const fromParam = searchParams.get("from");
    const toParam   = searchParams.get("to");
    const from = fromParam ? parseIsoDateOnly(fromParam) : indianFiscalYearStart();
    const to   = toParam   ? parseIsoDateOnly(toParam)   : new Date();
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
}

/** Format a Date as yyyy-mm-dd using local calendar components (NOT UTC). */
export function formatDateInput(d: Date): string {
    return toDateOnly(d);
}
