// Which answer a day is paid on — the till's (auto) or the office's (manual).
//
// Owner, 2026-10-13: *"in place of accept reject we have toggle which data to
// take. in the attendance page users manual input overrides auto."* So a day
// can carry both at once:
//
//   Auto   — the activity card: the till's own measurement, with any figure a
//            person corrected on the card standing in for the till's
//            (`overrideWorkedMinutes`, `overrideLateMinutes`).
//   Manual — the mark made on the Attendance page (`manualStatus`).
//
// `source` is the toggle (OFFICE = manual, COUNTER = auto) and `status` is what
// the chosen side says; marking a day on the Attendance page flips it to manual.
// The corrections are how the owner keeps control of auto: the card says, line
// by line, why a day adds or takes away pay, and a wrong line is fixed there.
//
// Every reader — payroll's day factors, the pay-rule netting, the day cards, the
// payslip — asks THESE functions, so they cannot disagree about a day.

export interface SourcedDay {
    source: string;
    workedMinutes: number;
    overrideWorkedMinutes: number | null;
}

/** The worked minutes auto stands on: the correction when there is one, else the till's. */
export function workedOf(day: Pick<SourcedDay, "workedMinutes" | "overrideWorkedMinutes">): number {
    return day.overrideWorkedMinutes ?? day.workedMinutes;
}

/** The lateness auto stands on: the correction when there is one, else what the clock measured. */
export function lateOf(day: { overrideLateMinutes: number | null }, measured: number): number {
    return day.overrideLateMinutes ?? measured;
}

/**
 * True when the day is paid on its (corrected) minutes — it runs on auto and
 * there are minutes to grade. False for a manual day, and for a till row that
 * measured nothing: both are paid on `status`.
 */
export function autoCounts(day: SourcedDay): boolean {
    return day.source === "COUNTER" && workedOf(day) > 0;
}

/** The columns every reader selects to ask the functions above. */
export const ATTENDANCE_SOURCE_SELECT = {
    source: true, workedMinutes: true, overrideWorkedMinutes: true, overrideLateMinutes: true,
} as const;
