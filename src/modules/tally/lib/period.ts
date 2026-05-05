// Reusable period parsing for Tally reports.
// Indian fiscal year: Apr 1 → Mar 31. asOf defaults to "now"; ranges default to current FY.

export type PeriodRange = { from: Date; to: Date };

export function indianFiscalYearStart(today = new Date()): Date {
    const y = today.getFullYear();
    const m = today.getMonth(); // Jan = 0, Apr = 3
    const fyYear = m < 3 ? y - 1 : y;
    return new Date(fyYear, 3, 1, 0, 0, 0, 0);
}

export function parseAsOf(searchParams: URLSearchParams): Date {
    const v = searchParams.get("asOf");
    const d = v ? new Date(v) : new Date();
    d.setHours(23, 59, 59, 999);
    return d;
}

export function parseRange(searchParams: URLSearchParams): PeriodRange {
    const fromParam = searchParams.get("from");
    const toParam   = searchParams.get("to");
    const from = fromParam ? new Date(fromParam) : indianFiscalYearStart();
    const to   = toParam   ? new Date(toParam)   : new Date();
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
}

export function formatDateInput(d: Date): string {
    return d.toISOString().slice(0, 10);
}
