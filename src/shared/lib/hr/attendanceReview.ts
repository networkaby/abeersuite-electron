// Whether a day the till measured is allowed to touch anybody's pay.
//
// Owner, 2026-10-12: *"auto attendance is under testing only let accept/edit/
// override since its not sure 100% correct, it will not effect directly without
// manual consideration"* — and the decision is made at the source, on Employee
// Activity, a whole day for the whole staff at a time.
//
// So a COUNTER day carries a decision. Only ACCEPTED lets its minutes grade the
// day (half / absent), earn overtime or weekly-off / holiday duty, or charge late
// and short time. WAITING and REJECTED both read as an ordinary paid day with no
// extras and no penalties: the clock says nothing until a person says it may.
//
// An office mark is a person's decision already and needs no second one; a till
// row with no minutes measured nothing, and has nothing to decide either.
//
// Every reader — payroll's day factors, the pay-rule netting, the day cards, the
// payslip — asks THIS function, so they cannot disagree about which days count.

export const ATTENDANCE_REVIEW_DECISIONS = ["ACCEPTED", "REJECTED"] as const;
export type AttendanceReviewDecision = (typeof ATTENDANCE_REVIEW_DECISIONS)[number];
export type AttendanceReview = AttendanceReviewDecision | "WAITING";

export const ATTENDANCE_REVIEW_LABELS: Record<AttendanceReview, string> = {
    WAITING:  "Waiting",
    ACCEPTED: "Accepted",
    REJECTED: "Rejected",
};

export interface ReviewableDay {
    source: string;
    workedMinutes: number;
    review: string | null;
    reviewedMinutes: number | null;
}

/**
 * The decision standing on a day, or null when the day is not the clock's to
 * decide (an office mark, or a till row that measured no minutes).
 *
 * A decision covers the figures it was made on: once the minutes move — a till
 * that synced late — the day is WAITING again rather than silently carrying a
 * yes it was never given.
 */
export function reviewOf(day: ReviewableDay): AttendanceReview | null {
    if (day.source !== "COUNTER" || day.workedMinutes <= 0) return null;
    const decided = day.review === "ACCEPTED" || day.review === "REJECTED";
    return decided && day.reviewedMinutes === day.workedMinutes ? day.review as AttendanceReviewDecision : "WAITING";
}

/** True when the clock's minutes on this day may count toward pay. */
export function clockCounts(day: ReviewableDay): boolean {
    return reviewOf(day) === "ACCEPTED";
}
