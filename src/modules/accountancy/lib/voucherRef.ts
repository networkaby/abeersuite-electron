// Shared helpers for VoucherSeries reference assembly.
// Used by nextRefFromSeries (server) and the Year Ending UI preview (client).

export type YearFormat = "CALENDAR" | "CALENDAR_SHORT" | "FY_SHORT" | "FY_LONG";
export type PartName = "type" | "user" | "year" | "number";

const RESERVED: ReadonlySet<string> = new Set(["type", "user", "year", "number"]);

export interface SeriesShape {
    typeEnabled:  boolean;
    typeValue:    string;
    userEnabled:  boolean;
    userMaxWidth: number;
    yearEnabled:  boolean;
    yearFormat:   string;
    fyStartYear:  number | null;
    startFrom:    number;
    padWidth:     number;
    nextSeq:      number;
    partOrder:    string;
}

export function formatYear(fyStartYear: number, format: string): string {
    const start = fyStartYear;
    const end = fyStartYear + 1;
    const ss = String(start).slice(-2);
    const es = String(end).slice(-2);
    switch (format) {
        case "CALENDAR":       return String(start);
        case "CALENDAR_SHORT": return ss;
        case "FY_SHORT":       return `${ss}-${es}`;
        case "FY_LONG":        return `${start}-${es}`;
        default:               return String(start);
    }
}

/** Indian fiscal year start (Apr 1). Returns the calendar year of FY start. */
export function indianFyStartYear(today = new Date()): number {
    return today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
}

/**
 * Returns the FY-start year for `today` given a books restart month/day.
 * If today is before the restart day this calendar year, FY starts last year.
 * restartMonth is 1-12, restartDay is 1-31.
 */
export function fyStartYearFor(restartMonth: number, restartDay: number, today = new Date()): number {
    const cy = today.getFullYear();
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
 * Assemble the reference string from a series + optional userId.
 * `nextSeq` on the series shape should already be the post-increment value.
 *
 * partOrder is a CSV. Reserved tokens (type/user/year/number) expand to
 * their values. Anything else is treated as a literal — letting admins
 * embed separators or arbitrary text inline. Disabled parts contribute
 * nothing (their token is dropped). Disabled tokens still preserve any
 * adjacent literals as-is, so be mindful when toggling.
 */
export function assembleReference(s: SeriesShape, userId?: number | null): string {
    const fyStart = s.fyStartYear ?? indianFyStartYear();
    const num = s.startFrom + s.nextSeq - 1;

    const tokens = s.partOrder.split(",").map((p) => p.trim());
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
            case "user":
                if (s.userEnabled && userId != null) {
                    const uStr = String(userId).padStart(s.userMaxWidth, "0");
                    out.push(uStr.slice(-s.userMaxWidth));
                }
                break;
            case "year":
                if (s.yearEnabled) {
                    out.push(formatYear(fyStart, s.yearFormat));
                }
                break;
            case "number":
                out.push(String(Math.max(0, num)).padStart(s.padWidth, "0"));
                break;
        }
    }

    return out.join("");
}
